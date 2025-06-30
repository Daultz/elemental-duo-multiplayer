// server.js - Elemental Duo Multiplayer Server
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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms storage
const gameRooms = new Map();

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = new Map();
        this.gameState = {
            currentLevel: 1,
            levelComplete: false,
            switches: [],
            firePlayer: {
                x: 50,
                y: 522,
                width: 28,
                height: 28,
                velX: 0,
                velY: 0,
                onGround: false,
                jumping: false,
                keys: { left: false, right: false, up: false }
            },
            waterPlayer: {
                x: 100,
                y: 522,
                width: 28,
                height: 28,
                velX: 0,
                velY: 0,
                onGround: false,
                jumping: false,
                keys: { left: false, right: false, up: false }
            }
        };
        this.lastUpdate = Date.now();
    }

    addPlayer(socket, playerType) {
        this.players.set(socket.id, {
            socket: socket,
            playerType: playerType, // 'fire' or 'water'
            ready: false
        });
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
    }

    isFull() {
        const full = this.players.size >= 2;
        console.log(`Room ${this.roomId} isFull check: ${this.players.size}/2 players, returning ${full}`);
        return full;
    }

    hasPlayerType(type) {
        for (let player of this.players.values()) {
            if (player.playerType === type) {
                console.log(`Room ${this.roomId} already has ${type} player`);
                return true;
            }
        }
        console.log(`Room ${this.roomId} does NOT have ${type} player`);
        return false;
    }

    broadcastToRoom(event, data) {
        for (let player of this.players.values()) {
            player.socket.emit(event, data);
        }
    }

    updatePlayerInput(socketId, keys) {
        const player = this.players.get(socketId);
        if (!player) return;

        if (player.playerType === 'fire') {
            this.gameState.firePlayer.keys = keys;
        } else if (player.playerType === 'water') {
            this.gameState.waterPlayer.keys = keys;
        }

        // Broadcast input to other players
        this.broadcastToRoom('playerInput', {
            playerType: player.playerType,
            keys: keys
        });
    }

    updateGameState(gameState) {
        this.gameState = { ...this.gameState, ...gameState };
        this.broadcastToRoom('gameStateUpdate', this.gameState);
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Join or create room
    socket.on('joinRoom', (data) => {
        const { roomId, playerName } = data;
        let room = gameRooms.get(roomId);

        if (!room) {
            room = new GameRoom(roomId);
            gameRooms.set(roomId, room);
            console.log(`Created new room: ${roomId}`);
        }

        if (room.isFull()) {
            console.log(`Room ${roomId} is full, rejecting player ${socket.id}`);
            socket.emit('roomFull');
            return;
        }

        // Assign player type based on what's available
        let playerType;
        if (!room.hasPlayerType('fire')) {
            playerType = 'fire';
        } else if (!room.hasPlayerType('water')) {
            playerType = 'water';
        } else {
            console.log(`Room ${roomId} has both player types, rejecting ${socket.id}`);
            socket.emit('roomFull');
            return;
        }

        // Add player to room
        room.addPlayer(socket, playerType);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerType = playerType;

        console.log(`Player ${socket.id} joined room ${roomId} as ${playerType} player. Room now has ${room.players.size}/2 players`);

        socket.emit('playerAssigned', {
            playerType: playerType,
            roomId: roomId,
            playersCount: room.players.size
        });

        // Notify other players in the room
        socket.to(roomId).emit('playerJoined', {
            playerType: playerType,
            playersCount: room.players.size
        });

        // Send initial game state
        socket.emit('gameStateUpdate', room.gameState);
    });

    // Handle player input
    socket.on('playerInput', (keys) => {
        if (!socket.roomId) return;
        const room = gameRooms.get(socket.roomId);
        if (room) {
            room.updatePlayerInput(socket.id, keys);
        }
    });

    // Handle game state updates
    socket.on('gameStateUpdate', (gameState) => {
        if (!socket.roomId) return;
        const room = gameRooms.get(socket.roomId);
        if (room) {
            // Update only the player's own character data
            if (socket.playerType === 'fire' && gameState.firePlayer) {
                room.gameState.firePlayer = { ...room.gameState.firePlayer, ...gameState.firePlayer };
            } else if (socket.playerType === 'water' && gameState.waterPlayer) {
                room.gameState.waterPlayer = { ...room.gameState.waterPlayer, ...gameState.waterPlayer };
            }
            
            // Update shared game state
            if (gameState.currentLevel) {
                room.gameState.currentLevel = gameState.currentLevel;
            }
            if (gameState.switches) {
                room.gameState.switches = gameState.switches;
            }
            
            // Broadcast ONLY to OTHER players in the room (not back to sender)
            socket.to(socket.roomId).emit('gameStateUpdate', room.gameState);
        }
    });

    // Handle level completion
    socket.on('levelComplete', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('levelComplete');
    });

    // Handle level restart
    socket.on('restartLevel', () => {
        if (!socket.roomId) return;
        const room = gameRooms.get(socket.roomId);
        if (room) {
            // Reset player positions
            room.gameState.firePlayer.x = 50;
            room.gameState.firePlayer.y = 522;
            room.gameState.firePlayer.velX = 0;
            room.gameState.firePlayer.velY = 0;
            room.gameState.firePlayer.onGround = false;
            room.gameState.firePlayer.jumping = false;

            room.gameState.waterPlayer.x = 100;
            room.gameState.waterPlayer.y = 522;
            room.gameState.waterPlayer.velX = 0;
            room.gameState.waterPlayer.velY = 0;
            room.gameState.waterPlayer.onGround = false;
            room.gameState.waterPlayer.jumping = false;

            room.gameState.levelComplete = false;
            room.broadcastToRoom('gameStateUpdate', room.gameState);
        }
    });

    // Handle next level
    socket.on('nextLevel', () => {
        if (!socket.roomId) return;
        const room = gameRooms.get(socket.roomId);
        if (room) {
            room.gameState.currentLevel++;
            room.gameState.levelComplete = false;
            
            // Reset player positions
            room.gameState.firePlayer.x = 50;
            room.gameState.firePlayer.y = 522;
            room.gameState.firePlayer.velX = 0;
            room.gameState.firePlayer.velY = 0;
            room.gameState.firePlayer.onGround = false;
            room.gameState.firePlayer.jumping = false;

            room.gameState.waterPlayer.x = 100;
            room.gameState.waterPlayer.y = 522;
            room.gameState.waterPlayer.velX = 0;
            room.gameState.waterPlayer.velY = 0;
            room.gameState.waterPlayer.onGround = false;
            room.gameState.waterPlayer.jumping = false;

            room.broadcastToRoom('gameStateUpdate', room.gameState);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        if (socket.roomId) {
            const room = gameRooms.get(socket.roomId);
            if (room) {
                room.removePlayer(socket.id);
                socket.to(socket.roomId).emit('playerLeft', {
                    playerType: socket.playerType,
                    playersCount: room.players.size
                });

                // Clean up empty rooms
                if (room.players.size === 0) {
                    gameRooms.delete(socket.roomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥💧 Elemental Duo Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to play!`);
});