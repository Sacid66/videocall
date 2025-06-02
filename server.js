const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const os = require('os');

const app = express();

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

// Odalar ve kullanıcıları takip et - DETAYLI
const rooms = new Map(); // room -> Set of userIds
const users = new Map(); // userId -> {id, name, room}

io.on('connection', (socket) => {
    console.log('✅ Kullanıcı bağlandı:', socket.id);

    socket.on('connect_error', (error) => {
        console.error('WebSocket bağlantı hatası:', error.message);
    });

    socket.on('create-room', (data) => {
        const { room, userName } = data;
        
        // Önceki odadan çık
        leaveCurrentRoom(socket);
        
        // Yeni odaya katıl
        socket.join(room);
        
        // Kullanıcı bilgilerini kaydet
        users.set(socket.id, {
            id: socket.id,
            name: userName,
            room: room
        });
        
        // Oda oluştur
        if (!rooms.has(room)) {
            rooms.set(room, new Set());
        }
        rooms.get(room).add(socket.id);
        
        socket.emit('room-created', { room });
        console.log(`🏠 Oda oluşturuldu: ${room}, Kullanıcı: ${userName}`);
        
        // Oda durumunu gönder
        broadcastRoomUpdate(room);
    });

    socket.on('join-room', (data, callback) => {
        const { room, userName } = data;
        
        if (!rooms.has(room)) {
            if (callback) callback({ error: 'Oda bulunamadı!' });
            socket.emit('error', { message: 'Oda bulunamadı!' });
            return;
        }
        
        // Önceki odadan çık
        leaveCurrentRoom(socket);
        
        // Yeni odaya katıl
        socket.join(room);
        
        // Kullanıcı bilgilerini kaydet
        users.set(socket.id, {
            id: socket.id,
            name: userName,
            room: room
        });
        
        rooms.get(room).add(socket.id);
        
        console.log(`👤 ${userName} odaya katıldı: ${room}`);
        
        // Oda durumunu güncelle
        broadcastRoomUpdate(room);
        
        if (callback) callback({ success: true });
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: socket.id,
            fromName: users.get(socket.id)?.name
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id,
            fromName: users.get(socket.id)?.name
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // Chat
    socket.on('chat-message', (data) => {
        const { room, message, sender } = data;
        socket.to(room).emit('chat-message', {
            message: message,
            sender: sender,
            timestamp: Date.now()
        });
    });

    // Ayrılma işlemleri
    socket.on('leave-room', () => {
        handleUserLeave(socket);
    });

    socket.on('host-ended-call', (data) => {
        handleUserLeave(socket);
    });

    socket.on('participant-left', (data) => {
        handleUserLeave(socket);
    });

    socket.on('disconnect', () => {
        handleUserLeave(socket);
    });

    // Yardımcı fonksiyonlar
    function leaveCurrentRoom(socket) {
        const user = users.get(socket.id);
        if (user && user.room) {
            const room = user.room;
            
            // Odadan çık
            socket.leave(room);
            
            // Oda listesinden çıkar
            if (rooms.has(room)) {
                rooms.get(room).delete(socket.id);
                
                // Oda boşsa sil
                if (rooms.get(room).size === 0) {
                    rooms.delete(room);
                    console.log(`🗑️ Oda silindi: ${room}`);
                } else {
                    // Diğerlerine bildir
                    broadcastRoomUpdate(room);
                }
            }
            
            // Kullanıcı kaydını temizle
            users.delete(socket.id);
        }
    }

    function handleUserLeave(socket) {
        const user = users.get(socket.id);
        if (user) {
            console.log(`👋 ${user.name} ayrıldı: ${user.room}`);
            leaveCurrentRoom(socket);
        }
    }

    function broadcastRoomUpdate(room) {
        if (!rooms.has(room)) return;
        
        const roomUsers = Array.from(rooms.get(room))
            .map(userId => users.get(userId))
            .filter(Boolean);
        
        const userCount = roomUsers.length;
        
        console.log(`📊 Oda güncellemesi: ${room}, ${userCount} kişi`);
        
        // Tüm odaya durum gönder
        io.to(room).emit('room-updated', {
            userCount: userCount,
            users: roomUsers,
            shouldStartCalls: userCount >= 2
        });
        
        // 2 kişi olduğunda P2P başlat
        if (userCount === 2) {
            setTimeout(() => {
                const [user1, user2] = roomUsers;
                
                // Her ikisine de birbirini gönder
                io.to(user1.id).emit('ready-for-call', {
                    targetUser: user2,
                    shouldOffer: user1.id < user2.id
                });
                
                io.to(user2.id).emit('ready-for-call', {
                    targetUser: user1,
                    shouldOffer: user2.id < user1.id
                });
            }, 1000);
        }
        
        // 3+ kişi için mesh network başlat
        if (userCount >= 3) {
            setTimeout(() => {
                roomUsers.forEach(user => {
                    const otherUsers = roomUsers.filter(u => u.id !== user.id);
                    io.to(user.id).emit('setup-mesh-calls', {
                        allUsers: otherUsers,
                        myInfo: user
                    });
                });
            }, 1000);
        }
    }
});

// Port - Render PORT env variable kullanır
const PORT = process.env.PORT || 3000;

// Sunucuyu başlat
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Multi-User Sunucu başlatıldı!`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 Render'da otomatik HTTPS sağlanacak`);
    console.log(`⏰ Başlangıç zamanı: ${new Date().toLocaleString('tr-TR')}\n`);
});
