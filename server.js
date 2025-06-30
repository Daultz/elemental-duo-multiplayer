// server.js - Elemental Duo Multiplayer Server v3.0
// Optimized for ultra-smooth multiplayer gaming with client-side prediction
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Optimize socket.io for real-time gaming
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    allowUpgrades: true
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms storage with improved state management
const gameRooms = new Map();

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = new Map();
        this.playerStates = new Map(); // Server-side player states
        this.currentLevel = 1;
        this.createdAt = new Date();
        this.lastUpdate = new Map(); // Track last update per player
        this.gameState = 'waiting'; // waiting, playing, complete
    }

    addPlayer(socket, playerType) {
        this.players.set(socket.id, {
            socket: socket,
            playerType: playerType,
            joinedAt: new Date(),
            lastSeen: Date.now()
        });
        
        // Initialize player state
        this.playerStates.set(socket.id, {
            x: playerType === 'fire' ? 50 : 100,
            y: 522,
            velX: 0,
            velY: 0,
            timestamp: Date.now(),
            sequenceNumber: 0
        });
        
        this.lastUpdate.set(socket.id, 0);
        
        if (this.players.size === 2) {
            this.gameState = 'playing';
        }
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        this.playerStates.delete(socketId);
        this.lastUpdate.delete(socketId);
        
        if (this.players.size < 2) {
            this.gameState = 'waiting';
        }
    }

    isFull() {
        return this.players.size >= 2;
    }

    hasPlayerType(type) {
        for (let player of this.players.values()) {
            if (player.playerType === type) return true;
        }
        return false;
    }

    broadcastToRoom(event, data, excludeSocket = null) {
        for (let player of this.players.values()) {
            if (player.socket !== excludeSocket) {
                player.socket.emit(event, data);
            }
        }
    }

    // Improved position validation and update
    updatePlayerPosition(socketId, positionData) {
        const now = Date.now();
        const lastUpdate = this.lastUpdate.get(socketId) || 0;
        
        // Rate limit to 15 updates per second per player
        if (now - lastUpdate < 67) {
            return false; // Skip this update
        }
        
        // Validate position bounds
        const x = Math.max(0, Math.min(1000 - 28, positionData.x || 0));
        const y = Math.max(0, Math.min(600, positionData.y || 0));
        const velX = Math.max(-12, Math.min(12, positionData.velX || 0));
        const velY = Math.max(-20, Math.min(20, positionData.velY || 0));
        
        // Update server state
        this.playerStates.set(socketId, {
            x: x,
            y: y,
            velX: velX,
            velY: velY,
            timestamp: now,
            sequenceNumber: positionData.sequenceNumber || 0
        });
        
        this.lastUpdate.set(socketId, now);
        
        // Get player info
        const player = this.players.get(socketId);
        if (!player) return false;
        
        // Forward to other players with validation
        const updateData = {
            playerType: player.playerType,
            x: x,
            y: y,
            velX: velX,
            velY: velY,
            timestamp: now,
            sequenceNumber: positionData.sequenceNumber || 0
        };
        
        for (let [otherId, otherPlayer] of this.players.entries()) {
            if (otherId !== socketId) {
                otherPlayer.socket.emit('playerPosition', updateData);
            }
        }
        
        return true;
    }

    // Input-based movement for better prediction
    processPlayerInput(socketId, inputData) {
        const now = Date.now();
        const lastUpdate = this.lastUpdate.get(socketId) || 0;
        
        // Rate limit inputs
        if (now - lastUpdate < 50) {
            return false;
        }
        
        this.lastUpdate.set(socketId, now);
        
        const player = this.players.get(socketId);
        if (!player) return false;
        
        // Forward input to other players for immediate response
        const forwardData = {
            playerType: player.playerType,
            keys: inputData.keys,
            timestamp: now,
            sequenceNumber: inputData.sequenceNumber || 0
        };
        
        for (let [otherId, otherPlayer] of this.players.entries()) {
            if (otherId !== socketId) {
                otherPlayer.socket.emit('playerInput', forwardData);
            }
        }
        
        return true;
    }

    getStats() {
        return {
            roomId: this.roomId,
            playerCount: this.players.size,
            currentLevel: this.currentLevel,
            gameState: this.gameState,
            uptime: Date.now() - this.createdAt.getTime()
        };
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`🔌 Player connected: ${socket.id}`);
    
    // Set socket timeout for responsiveness
    socket.timeout = setTimeout(() => {
        console.log(`⏰ Socket ${socket.id} timed out`);
        socket.disconnect();
    }, 300000); // 5 minute timeout

    // Join or create room
    socket.on('joinRoom', (data) => {
        try {
            const { roomId, playerName } = data;
            
            // Validate input
            if (!roomId || !playerName || typeof roomId !== 'string' || typeof playerName !== 'string') {
                console.log(`❌ Invalid data from ${socket.id}:`, data);
                socket.emit('error', { message: 'Invalid room ID or player name' });
                return;
            }
            
            // Clean the room ID
            const cleanRoomId = roomId.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const cleanPlayerName = playerName.trim().substring(0, 20);
            
            if (cleanRoomId.length < 3) {
                socket.emit('error', { message: 'Room ID must be at least 3 characters' });
                return;
            }
            
            console.log(`🎯 Player ${socket.id} (${cleanPlayerName}) attempting to join room: ${cleanRoomId}`);
            
            let room = gameRooms.get(cleanRoomId);

            if (!room) {
                room = new GameRoom(cleanRoomId);
                gameRooms.set(cleanRoomId, room);
                console.log(`🏠 Created new room: ${cleanRoomId}`);
            }

            if (room.isFull()) {
                console.log(`❌ Room ${cleanRoomId} is full (${room.players.size}/2)`);
                socket.emit('roomFull');
                return;
            }

            // Leave previous room if any
            if (socket.roomId) {
                console.log(`🔄 Player ${socket.id} leaving previous room: ${socket.roomId}`);
                socket.leave(socket.roomId);
                const oldRoom = gameRooms.get(socket.roomId);
                if (oldRoom) {
                    oldRoom.removePlayer(socket.id);
                }
            }

            // Assign player type
            let playerType;
            if (!room.hasPlayerType('fire')) {
                playerType = 'fire';
            } else if (!room.hasPlayerType('water')) {
                playerType = 'water';
            } else {
                console.log(`❌ Room ${cleanRoomId} assignment error`);
                socket.emit('roomFull');
                return;
            }

            // Add player to room
            room.addPlayer(socket, playerType);
            socket.join(cleanRoomId);
            socket.roomId = cleanRoomId;
            socket.playerType = playerType;
            socket.playerName = cleanPlayerName;

            console.log(`✅ ${cleanPlayerName} (${playerType}) joined room ${cleanRoomId} (${room.players.size}/2)`);

            // Send confirmation
            socket.emit('playerAssigned', {
                playerType: playerType,
                roomId: cleanRoomId,
                playersCount: room.players.size,
                playerName: cleanPlayerName
            });

            // Notify other players
            room.broadcastToRoom('playerJoined', {
                playerType: playerType,
                playersCount: room.players.size,
                playerName: cleanPlayerName,
                roomId: cleanRoomId
            }, socket);
            
        } catch (error) {
            console.error('❌ Error in joinRoom:', error);
            socket.emit('error', { message: 'Failed to join room. Please try again.' });
        }
    });

    // SIMPLIFIED: Direct input forwarding for immediate response
    socket.on('playerInput', (inputData) => {
        try {
            if (!socket.roomId || !socket.playerType) return;
            
            const room = gameRooms.get(socket.roomId);
            if (!room) return;
            
            const now = Date.now();
            const lastUpdate = room.lastUpdate.get(socket.id) || 0;
            
            // Simple rate limiting
            if (now - lastUpdate < 50) {
                return; // Skip this update
            }
            
            room.lastUpdate.set(socket.id, now);
            
            // Forward input immediately to other players
            const inputForward = {
                playerType: socket.playerType,
                keys: inputData.keys,
                timestamp: now
            };
            
            for (let [otherId, otherPlayer] of room.players.entries()) {
                if (otherId !== socket.id) {
                    otherPlayer.socket.emit('playerInput', inputForward);
                }
            }
            
        } catch (error) {
            console.error('Error processing input:', error);
        }
    });

    // SIMPLIFIED: Direct position updates
    socket.on('playerPosition', (positionData) => {
        try {
            if (!socket.roomId || !socket.playerType) return;
            
            const room = gameRooms.get(socket.roomId);
            if (!room) return;
            
            const now = Date.now();
            const lastUpdate = room.lastUpdate.get(socket.id) || 0;
            
            // Rate limit to 15 updates per second
            if (now - lastUpdate < 67) {
                return; // Skip this update
            }
            
            room.lastUpdate.set(socket.id, now);
            
            // Basic validation
            const x = Math.max(0, Math.min(972, positionData.x || 0)); // 1000 - 28 (player width)
            const y = Math.max(0, Math.min(600, positionData.y || 0));
            
            // Forward to other players
            const positionUpdate = {
                playerType: socket.playerType,
                x: x,
                y: y,
                velX: positionData.velX || 0,
                velY: positionData.velY || 0,
                timestamp: now
            };
            
            for (let [otherId, otherPlayer] of room.players.entries()) {
                if (otherId !== socket.id) {
                    otherPlayer.socket.emit('playerPosition', positionUpdate);
                }
            }
            
        } catch (error) {
            console.error('Error updating position:', error);
        }
    });

    // Handle level events
    socket.on('levelComplete', () => {
        try {
            if (!socket.roomId) return;
            
            const room = gameRooms.get(socket.roomId);
            if (!room) return;
            
            console.log(`🎉 Level completed in room ${socket.roomId}`);
            room.gameState = 'complete';
            room.broadcastToRoom('levelComplete', {}, socket);
        } catch (error) {
            console.error('Error in levelComplete:', error);
        }
    });

    socket.on('restartLevel', () => {
        try {
            if (!socket.roomId) return;
            
            const room = gameRooms.get(socket.roomId);
            if (!room) return;
            
            console.log(`🔄 Level restart in room ${socket.roomId}`);
            room.gameState = 'playing';
            room.broadcastToRoom('restartLevel', {}, socket);
        } catch (error) {
            console.error('Error in restartLevel:', error);
        }
    });

    socket.on('nextLevel', () => {
        try {
            if (!socket.roomId) return;
            
            const room = gameRooms.get(socket.roomId);
            if (!room) return;
            
            room.currentLevel++;
            room.gameState = 'playing';
            console.log(`⬆️ Advanced to level ${room.currentLevel} in room ${socket.roomId}`);
            room.broadcastToRoom('nextLevel', {}, socket);
        } catch (error) {
            console.error('Error in nextLevel:', error);
        }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
        console.log(`🔌 Player disconnected: ${socket.id}, reason: ${reason}`);
        
        if (socket.timeout) {
            clearTimeout(socket.timeout);
        }
        
        if (socket.roomId) {
            const room = gameRooms.get(socket.roomId);
            if (room) {
                room.removePlayer(socket.id);
                console.log(`👋 ${socket.playerName || 'Player'} left room ${socket.roomId}`);
                
                room.broadcastToRoom('playerLeft', {
                    playerType: socket.playerType,
                    playersCount: room.players.size,
                    playerName: socket.playerName
                });

                // Clean up empty rooms
                if (room.players.size === 0) {
                    setTimeout(() => {
                        const currentRoom = gameRooms.get(socket.roomId);
                        if (currentRoom && currentRoom.players.size === 0) {
                            gameRooms.delete(socket.roomId);
                            console.log(`🗑️ Deleted empty room: ${socket.roomId}`);
                        }
                    }, 5000);
                }
            }
        }
    });

    // Debug endpoints
    socket.on('getRoomStats', () => {
        try {
            if (socket.roomId) {
                const room = gameRooms.get(socket.roomId);
                if (room) {
                    socket.emit('roomStats', room.getStats());
                }
            }
        } catch (error) {
            console.error('Error getting room stats:', error);
        }
    });

    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeRooms: gameRooms.size,
        totalPlayers: Array.from(gameRooms.values()).reduce((sum, room) => sum + room.players.size, 0),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Room stats endpoint
app.get('/stats', (req, res) => {
    const stats = {
        totalRooms: gameRooms.size,
        totalPlayers: Array.from(gameRooms.values()).reduce((sum, room) => sum + room.players.size, 0),
        rooms: Array.from(gameRooms.values()).map(room => room.getStats())
    };
    res.json(stats);
});

// Cleanup stale rooms
setInterval(() => {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    
    for (let [roomId, room] of gameRooms.entries()) {
        const roomAge = now - room.createdAt.getTime();
        if (room.players.size === 0 && roomAge > staleThreshold) {
            gameRooms.delete(roomId);
            console.log(`🧹 Cleaned up stale room: ${roomId}`);
        }
    }
}, 5 * 60 * 1000);

// Server heartbeat for monitoring
setInterval(() => {
    const activeRooms = gameRooms.size;
    const totalPlayers = Array.from(gameRooms.values()).reduce((sum, room) => sum + room.players.size, 0);
    
    if (activeRooms > 0) {
        console.log(`💓 Server heartbeat: ${activeRooms} rooms, ${totalPlayers} players`);
    }
}, 30000); // Every 30 seconds

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥💧 Elemental Duo Server v3.0 running on port ${PORT}`);
    console.log(`🌐 Ready for ultra-smooth multiplayer action!`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Room stats: http://localhost:${PORT}/stats`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Server shutting down gracefully...');
    
    for (let room of gameRooms.values()) {
        room.broadcastToRoom('serverShutdown', {
            message: 'Server is restarting. Please refresh to reconnect.'
        });
    }
    
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.emit('SIGTERM');
});