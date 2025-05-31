const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const os = require('os');

const app = express();

// CSP başlığını ekle (güvenlik için dikkatli kullan)
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-eval' https://cdnjs.cloudflare.com; connect-src 'self' https://videocall-7f35.onrender.com wss://videocall-7f35.onrender.com;"
    );
    next();
});

// Statik dosyaları servis et
app.use(express.static(__dirname));

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint (Render için)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// HTTP sunucusu oluştur (Render HTTPS'i otomatik sağlar)
const server = http.createServer(app);

// Socket.io'yu sunucuya bağla
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    secure: true
});

// Odalar ve kullanıcıları takip et
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('✅ Kullanıcı bağlandı:', socket.id);

    socket.on('connect_error', (error) => {
        console.error('WebSocket bağlantı hatası:', error.message);
    });

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

    socket.on('join-room', (data, callback) => {
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
            
            // WebRTC bağlantısını başlat - her iki kullanıcıya da bildir (sadece 2 kişi olduğunda)
            if (rooms.get(room).size === 2) {
                const users = Array.from(rooms.get(room));
                const firstUser = users[0];
                const secondUser = users[1];
                
                // İlk kullanıcıya ikinci kullanıcının katıldığını bildir
                io.to(firstUser).emit('ready-to-call', { 
                    userId: secondUser,
                    userName: io.sockets.sockets.get(secondUser)?.data.userName 
                });
                
                // İkinci kullanıcıya ilk kullanıcının katıldığını bildir
                io.to(secondUser).emit('ready-to-call', { 
                    userId: firstUser,
                    userName: io.sockets.sockets.get(firstUser)?.data.userName 
                });
            }
            if (callback) callback({ success: true });
        } else {
            if (callback) callback({ error: 'Oda bulunamadı!' });
            socket.emit('error', { message: 'Oda bulunamadı!' });
        }
    });

    socket.on('offer', (data) => {
        console.log('📤 Offer gönderiliyor');
        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        console.log('📤 Answer gönderiliyor');
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        console.log('🧊 ICE candidate gönderiliyor');
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id,
            room: socket.data.room
        });
    });

    socket.on('leave-room', () => {
        handleDisconnect(socket);
    });

    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });

    function handleDisconnect(socket) {
        const room = socket.data.room;
        if (room && rooms.has(room)) {
            rooms.get(room).delete(socket.id);
            
            if (rooms.get(room).size === 0) {
                rooms.delete(room);
                console.log(`🗑️ Oda silindi: ${room}`);
            } else {
                socket.to(room).emit('user-left', { 
                    userName: socket.data.userName,
                    userId: socket.id
                });
                socket.to(room).emit('peer-disconnected', { userId: socket.id });
            }
            
            console.log(`👋 ${socket.data.userName} ayrıldı: ${room}`);
        }
    }
});

// Port - Render PORT env variable kullanır
const PORT = process.env.PORT || 3000;

// Sunucuyu başlat
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Sunucu başlatıldı!`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 Render'da otomatik HTTPS sağlanacak`);
    console.log(`⏰ Başlangıç zamanı: ${new Date().toLocaleString('tr-TR')}\n`);
});