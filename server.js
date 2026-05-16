const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Odalardaki kişileri hafızada tutacağımız liste
const rooms = {};

io.on('connection', (socket) => {
    
    // Odaya isimle katılma
    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.username = username || "Anonim";
        socket.roomId = roomId;

        if(!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId].push({ id: socket.id, name: socket.username });

        // Odadaki herkese güncel kişi listesini gönder
        io.to(roomId).emit('update-users', rooms[roomId]);
        
        // Yeni biri geldiğinde yayıncıyı uyar
        socket.to(roomId).emit('peer-joined', socket.id);
        console.log(`${socket.username} odaya katıldı: ${roomId}`);
    });

    // Chat mesajlarını odadaki herkese ilet
    socket.on('chat-message', (msg) => {
        io.to(socket.roomId).emit('chat-message', { sender: socket.username, text: msg });
    });

    // Manuel Yenileme Tuşu Tetikleyicisi
    socket.on('force-refresh', () => {
        socket.to(socket.roomId).emit('force-refresh', socket.id);
    });

    // WebRTC Sinyalleri
    socket.on('signal', (data) => {
        io.to(data.to).emit('signal', { sender: socket.id, signal: data.signal });
    });

    // Biri çıkınca listeden sil ve haber ver
    socket.on('disconnect', () => {
        if(socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId] = rooms[socket.roomId].filter(u => u.id !== socket.id);
            io.to(socket.roomId).emit('update-users', rooms[socket.roomId]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Watch Par-t http://localhost:${PORT} portunda yayında!`));