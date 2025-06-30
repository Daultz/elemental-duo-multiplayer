// server.js - Elemental Duo Multiplayer Server v2.0
// Optimized for lag-free multiplayer gaming
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
    }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms storage - Lightweight approach
const gameRooms = new Map();

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = new Map();
        this.currentLevel = 1;
        this.createdAt = new Date();
    }

    addPlayer(socket, playerType) {
        this.players.set(socket.id, {
            socket: socket,
            playerType: playerType,
            joinedAt: new Date()
        });
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
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

    broadcastToRoom(event, data) {
        for (let player of this.players.values()) {
            player.socket.emit(event, data);
        }
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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`🔌 Player connected: ${socket.id}`);

    // Join or create room
    socket.on('joinRoom', (data) => {
        const { roomId, playerName } = data;
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
        socket.to(roomId).emit('playerJoined', {
            playerType: playerType,
            playersCount: room.players.size,
            playerName: playerName
        });
    });

    // Handle input forwarding - Core multiplayer functionality
    socket.on('playerInput', (keys) => {
        if (!socket.roomId || !socket.playerType) return;
        
        // Forward input to other players in room
        socket.to(socket.roomId).emit('playerInput', {
            playerType: socket.playerType,
            keys: keys
        });
    });

    // Handle level events
    socket.on('levelComplete', () => {
        if (!socket.roomId) return;
        console.log(`🎉 Level completed in room ${socket.roomId}`);
        socket.to(socket.roomId).emit('levelComplete');
    });

    socket.on('restartLevel', () => {
        if (!socket.roomId) return;
        console.log(`🔄 Level restart in room ${socket.roomId}`);
        socket.to(socket.roomId).emit('restartLevel');
    });

    socket.on('nextLevel', () => {
        if (!socket.roomId) return;
        const room = gameRooms.get(socket.roomId);
        if (room) {
            room.currentLevel++;
            console.log(`⬆️ Advanced to level ${room.currentLevel} in room ${socket.roomId}`);
            socket.to(socket.roomId).emit('nextLevel');
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`🔌 Player disconnected: ${socket.id}`);
        
        if (socket.roomId) {
            const room = gameRooms.get(socket.roomId);
            if (room) {
                room.removePlayer(socket.id);
                console.log(`👋 ${socket.playerName || 'Player'} left room ${socket.roomId}`);
                
                socket.to(socket.roomId).emit('playerLeft', {
                    playerType: socket.playerType,
                    playersCount: room.players.size,
                    playerName: socket.playerName
                });

                // Clean up empty rooms
                if (room.players.size === 0) {
                    gameRooms.delete(socket.roomId);
                    console.log(`🗑️ Deleted empty room: ${socket.roomId}`);
                }
            }
        }
    });

    // Debug endpoint for room stats
    socket.on('getRoomStats', () => {
        if (socket.roomId) {
            const room = gameRooms.get(socket.roomId);
            if (room) {
                socket.emit('roomStats', room.getStats());
            }
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeRooms: gameRooms.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Room stats endpoint
app.get('/stats', (req, res) => {
    const stats = {
        totalRooms: gameRooms.size,
        rooms: Array.from(gameRooms.values()).map(room => room.getStats())
    };
    res.json(stats);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥💧 Elemental Duo Server v2.0 running on port ${PORT}`);
    console.log(`🌐 Ready for multiplayer action!`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Room stats: http://localhost:${PORT}/stats`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Server shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});