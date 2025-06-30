// server.js - Elemental Duo Multiplayer Server v2.1
// Optimized for ultra-smooth multiplayer gaming with reduced lag
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

// Game rooms storage - Ultra-lightweight approach
const gameRooms = new Map();

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = new Map();
        this.currentLevel = 1;
        this.createdAt = new Date();
        this.lastInputUpdate = new Map(); // Track last input per player
    }

    addPlayer(socket, playerType) {
        this.players.set(socket.id, {
            socket: socket,
            playerType: playerType,
            joinedAt: new Date(),
            lastSeen: Date.now()
        });
        this.lastInputUpdate.set(socket.id, 0);
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        this.lastInputUpdate.delete(socketId);
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

    // Improved input forwarding with throttling
    forwardInput(fromSocket, inputData) {
        const now = Date.now();
        const lastUpdate = this.lastInputUpdate.get(fromSocket.id) || 0;
        
        // Throttle to max 20 updates per second per player
        if (now - lastUpdate < 50) {
            return false; // Skip this update
        }
        
        this.lastInputUpdate.set(fromSocket.id, now);
        
        // Forward to other players only
        for (let player of this.players.values()) {
            if (player.socket !== fromSocket) {
                player.socket.emit('playerInput', inputData);
            }
        }
        
        return true;
    }

    getStats() {
        return {
            roomId: this.roomId,
            playerCount: this.players.size,
            currentLevel: this.currentLevel,
            uptime: Date.now() - this.createdAt.getTime()
        };
    }
}

// Socket.io connection handling with improved error handling
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
            
            if (!roomId || !playerName) {
                socket.emit('error', { message: 'Invalid room ID or player name' });
                return;
            }
            
            let room = gameRooms.get(roomId);

            if (!room) {
                room = new GameRoom(roomId);
                gameRooms.set(roomId, room);
                console.log(`🏠 Created new room: ${roomId}`);
            }

            if (room.isFull()) {
                console.log(`❌ Room ${roomId} is full`);
                socket.emit('roomFull');
                return;
            }

            // Assign player type based on availability
            let playerType;
            if (!room.hasPlayerType('fire')) {
                playerType = 'fire';
            } else if (!room.hasPlayerType('water')) {
                playerType = 'water';
            } else {
                socket.emit('roomFull');
                return;
            }

            // Add player to room
            room.addPlayer(socket, playerType);
            socket.join(roomId);
            socket.roomId = roomId;
            socket.playerType = playerType;
            socket.playerName = playerName;

            console.log(`🎮 ${playerName} (${playerType}) joined room ${roomId} (${room.players.size}/2)`);

            socket.emit('playerAssigned', {
                playerType: playerType,
                roomId: roomId,
                playersCount: room.players.size
            });

            // Notify other players
            room.broadcastToRoom('playerJoined', {
                playerType: playerType,
                playersCount: room.players.size,
                playerName: playerName
            }, socket);
        } catch (error) {
            console.error('Error in joinRoom:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });

    // Optimized input forwarding - Core multiplayer functionality
    socket.on('playerInput', (keys) => {
        try {
            if (!socket.roomId || !socket.playerType) return;
            
            const room = gameRooms.get(socket.roomId);
            if (!room) return;
            
            // Use room's throttled forwarding system
            room.forwardInput(socket, {
                playerType: socket.playerType,
                keys: keys,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error forwarding input:', error);
        }
    });

    // Handle level events with validation
    socket.on('levelComplete', () => {
        try {
            if (!socket.roomId) return;
            
            const room = gameRooms.get(socket.roomId);
            if (!room) return;
            
            console.log(`🎉 Level completed in room ${socket.roomId}`);
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
            console.log(`⬆️ Advanced to level ${room.currentLevel} in room ${socket.roomId}`);
            room.broadcastToRoom('nextLevel', {}, socket);
        } catch (error) {
            console.error('Error in nextLevel:', error);
        }
    });

    // Handle disconnection with cleanup
    socket.on('disconnect', (reason) => {
        console.log(`🔌 Player disconnected: ${socket.id}, reason: ${reason}`);
        
        // Clear timeout
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

                // Clean up empty rooms after a delay
                if (room.players.size === 0) {
                    setTimeout(() => {
                        const currentRoom = gameRooms.get(socket.roomId);
                        if (currentRoom && currentRoom.players.size === 0) {
                            gameRooms.delete(socket.roomId);
                            console.log(`🗑️ Deleted empty room: ${socket.roomId}`);
                        }
                    }, 5000); // 5 second delay to allow reconnection
                }
            }
        }
    });

    // Debug endpoint for room stats
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

    // Handle errors
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

// Cleanup stale rooms periodically
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
}, 5 * 60 * 1000); // Run every 5 minutes

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥💧 Elemental Duo Server v2.1 running on port ${PORT}`);
    console.log(`🌐 Ready for ultra-smooth multiplayer action!`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Room stats: http://localhost:${PORT}/stats`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Server shutting down gracefully...');
    
    // Notify all connected players
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