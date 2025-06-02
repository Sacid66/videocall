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

// Odalar ve kullanıcıları takip et
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('✅ Kullanıcı bağlandı:', socket.id);

    socket.on('connect_error', (error) => {
        console.error('WebSocket bağlantı hatası:', error.message);
    });

    socket.on('create-room', (data) => {
    const { room, userName } = data;
    
    // Önceki odadan çık
    if (socket.data.room) {
        socket.leave(socket.data.room);
        if (rooms.has(socket.data.room)) {
            rooms.get(socket.data.room).delete(socket.id);
            if (rooms.get(socket.data.room).size === 0) {
                rooms.delete(socket.data.room);
            }
        }
    }
    
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
        // Önceki odadan çık
        if (socket.data.room) {
            socket.leave(socket.data.room);
            if (rooms.has(socket.data.room)) {
                rooms.get(socket.data.room).delete(socket.id);
                if (rooms.get(socket.data.room).size === 0) {
                    rooms.delete(socket.data.room);
                }
            }
        }
        
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
        
        // BU KISMI DEĞİŞTİR - ESKİ ready-to-call kısmını sil, yenisini koy:
        // 2+ kişi olduğunda bağlantı kur
        const userCount = rooms.get(room).size;
        if (userCount >= 2) {
            setTimeout(() => {
                const users = Array.from(rooms.get(room));
                const currentUserCount = users.length;
                
                if (currentUserCount === 2) {
                    // 2 kişi - normal P2P
                    const firstUser = users[0];
                    const secondUser = users[1];
                    
                    io.to(firstUser).emit('peer-reset');
                    io.to(secondUser).emit('peer-reset');
                    
                    setTimeout(() => {
                        io.to(firstUser).emit('ready-to-call', { 
                            userId: secondUser,
                            userName: io.sockets.sockets.get(secondUser)?.data.userName,
                            shouldOffer: firstUser < secondUser,
                            userCount: 2
                        });
                        
                        io.to(secondUser).emit('ready-to-call', { 
                            userId: firstUser,
                            userName: io.sockets.sockets.get(firstUser)?.data.userName,
                            shouldOffer: secondUser < firstUser,
                            userCount: 2
                        });
                    }, 500);
                    
                } else if (currentUserCount >= 3) {
                    // 3+ kişi - layout değişikliği
                    io.to(room).emit('user-count-changed', { 
                        userCount: currentUserCount,
                        newUserName: userName,
                        users: users.map(id => ({
                            id: id,
                            name: io.sockets.sockets.get(id)?.data.userName
                        }))
                    });
                    
                    console.log(`👥 ${currentUserCount} kişilik grup oluştu: ${room}`);
                }
            }, 2000);
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
    console.log(`🚪 Kullanıcı manuel olarak odadan ayrılıyor: ${socket.data.userName}`);
    handleDisconnect(socket);
});
    
    socket.on('chat-message', (data) => {
    const { room, message, sender } = data;
    console.log(`💬 Mesaj gönderildi - Oda: ${room}, Gönderen: ${sender}, Mesaj: ${message}`);
    
    // Mesajı aynı odadaki diğer kullanıcılara gönder (gönderen hariç)
    socket.to(room).emit('chat-message', {
        message: message,
        sender: sender,
        timestamp: Date.now()
    });
});


socket.on('host-ended-call', (data) => {
    const room = data.room;
    console.log(`🚪 Host aramayı sonlandırdı: ${room}`);
    
    if (rooms.has(room)) {
        const roomUsers = Array.from(rooms.get(room));
        const remainingUsers = roomUsers.filter(id => id !== socket.id);
        
        // Host'u odadan çıkar
        rooms.get(room).delete(socket.id);
        socket.leave(room);
        socket.data.room = null; // EKLE
        
        if (remainingUsers.length > 0) {
            // Yeni host ata
            const newHostId = remainingUsers[0];
            const newHostSocket = io.sockets.sockets.get(newHostId);
            
            if (newHostSocket) {
                newHostSocket.emit('you-are-new-host');
                socket.to(room).emit('new-host-assigned', {
                    newHostName: newHostSocket.data.userName
                });
                console.log(`👑 Yeni host atandı: ${newHostSocket.data.userName}`);
            }
        } else {
            // Kimse kalmadı - odayı sil
            rooms.delete(room);
            console.log(`🗑️ Host ayrıldıktan sonra oda silindi: ${room}`);
        }
    }
});


socket.on('participant-left', (data) => {
    const room = data.room;
    console.log(`👋 Katılımcı ayrıldı: ${room}`);
    
    if (rooms.has(room)) {
        rooms.get(room).delete(socket.id);
        socket.leave(room);
        socket.data.room = null; // EKLE
        
        if (rooms.get(room).size > 0) {
            socket.to(room).emit('participant-left');
        } else {
            rooms.delete(room);
            console.log(`🗑️ Son katılımcı da ayrıldı, oda silindi: ${room}`);
        }
    }
});
    
    
    
    
    
    
    
socket.on('disconnect', () => {
    handleDisconnect(socket);
});

function handleDisconnect(socket) {
    const room = socket.data.room;
    if (room && rooms.has(room)) {
        const roomUsers = rooms.get(room);
        roomUsers.delete(socket.id);
        
        console.log(`👋 ${socket.data.userName} ayrıldı: ${room}, Kalan: ${roomUsers.size}`);
        
        if (roomUsers.size === 0) {
            // Oda tamamen boş - SİL
            rooms.delete(room);
            console.log(`🗑️ Oda tamamen silindi: ${room}`);
        } else {
            // Hala kullanıcı var - bildir
            socket.to(room).emit('user-left', { 
                userName: socket.data.userName,
                userId: socket.id
            });
            socket.to(room).emit('peer-disconnected', { userId: socket.id });
        }
    }
    
    // Socket'i odadan çıkar
    if (room) {
        socket.leave(room);
    }
    
    // Socket data'sını temizle
    socket.data.room = null;
    socket.data.userName = null;
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
