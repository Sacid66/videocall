const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();

// Statik dosyaları servis et
app.use(express.static(__dirname));

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// HTTP sunucusu oluştur (Render HTTPS'i otomatik sağlar)
const server = http.createServer(app);

// Socket.io'yu sunucuya bağla
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Odalar ve kullanıcıları takip et
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('✅ Kullanıcı bağlandı:', socket.id);

    socket.on('create-room', (data) => {
        const { room, userName } = data;
        
        socket.join(room);
        socket.data.userName = userName;
        socket.data.room = room;
        
        if (!rooms.has(room)) {
            rooms.set(room, new Set());
        }
        rooms.get(room).add(socket.id);
        
        socket.emit('room-created', { room });
        console.log(`🏠 Oda oluşturuldu: ${room}, Kullanıcı: ${userName}`);
    });

    socket.on('join-room', (data) => {
        const { room, userName } = data;
        
        if (rooms.has(room)) {
            socket.join(room);
            socket.data.userName = userName;
            socket.data.room = room;
            
            rooms.get(room).add(socket.id);
            
            // Odadaki diğer kullanıcılara bildir
            socket.to(room).emit('user-joined', { userName });
            
            // Yeni katılan kullanıcıya mevcut kullanıcıları bildir
            const existingUsers = Array.from(rooms.get(room))
                .filter(id => id !== socket.id)
                .map(id => io.sockets.sockets.get(id)?.data.userName)
                .filter(Boolean);
            
            socket.emit('existing-users', { users: existingUsers });
            
            console.log(`👤 ${userName} odaya katıldı: ${room}`);
            
            // WebRTC bağlantısını başlat
            // İlk kullanıcı offer gönderir
            if (rooms.get(room).size === 2) {
                const users = Array.from(rooms.get(room));
                const firstUser = users[0];
                io.to(firstUser).emit('start-call', { to: socket.id });
            }
        } else {
            socket.emit('error', { message: 'Oda bulunamadı!' });
        }
    });

    socket.on('offer', (data) => {
        console.log('📤 Offer gönderiliyor:', data.to || data.room);
        if (data.to) {
            socket.to(data.to).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        } else {
            socket.to(data.room).emit('offer', {
                offer: data.offer,
                from: socket.id
            });
        }
    });

    socket.on('answer', (data) => {
        console.log('📤 Answer gönderiliyor:', data.to || data.room);
        if (data.to) {
            socket.to(data.to).emit('answer', {
                answer: data.answer,
                from: socket.id
            });
        } else {
            socket.to(data.room).emit('answer', {
                answer: data.answer,
                from: socket.id
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data.to) {
            socket.to(data.to).emit('ice-candidate', {
                candidate: data.candidate,
                from: socket.id
            });
        } else {
            socket.to(data.room).emit('ice-candidate', {
                candidate: data.candidate,
                from: socket.id
            });
        }
    });

    socket.on('leave-room', () => {
        handleDisconnect();
    });

    socket.on('disconnect', () => {
        handleDisconnect();
    });

    function handleDisconnect() {
        const room = socket.data.room;
        if (room && rooms.has(room)) {
            rooms.get(room).delete(socket.id);
            
            if (rooms.get(room).size === 0) {
                rooms.delete(room);
            } else {
                socket.to(room).emit('user-left', { 
                    userName: socket.data.userName 
                });
            }
            
            console.log(`👋 ${socket.data.userName} ayrıldı: ${room}`);
        }
    }
});

const PORT = process.env.PORT || 3000;

// Sunucuyu başlat
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Sunucu çalışıyor - Port: ${PORT}`);
    console.log(`🌐 Render'da otomatik HTTPS sağlanacak`);
});