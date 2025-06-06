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
   
   // Bağlantı kuruldu bilgisi gönder
   socket.emit('connection-established');

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
           
           console.log(`👋 ${user.name} odadan ayrılıyor: ${room}`);
           
           // Odadan çık
           socket.leave(room);
           
           // Oda listesinden çıkar
           if (rooms.has(room)) {
               rooms.get(room).delete(socket.id);
           }
           
           // Kullanıcı kaydını temizle
           users.delete(socket.id);
           
           // Oda durumunu güncelle (ayrıldıktan sonra)
           if (rooms.has(room)) {
               broadcastRoomUpdate(room);
           }
       }
   }

   function handleUserLeave(socket) {
       const user = users.get(socket.id);
       if (user) {
           const room = user.room;
           console.log(`👋 ${user.name} ayrıldı: ${room}`);
           
           // Diğer kullanıcılara bildir
           socket.to(room).emit('peer-disconnected', {
               userId: socket.id,
               userName: user.name
           });
           
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
        shouldStartCalls: userCount === 2 // Sadece 2 kişi olduğunda
    });
    
    // Eğer kimse kalmadıysa odayı sil
    if (userCount === 0) {
        rooms.delete(room);
        console.log(`🗑️ Oda tamamen silindi: ${room}`);
        return;
    }
    
    // Sadece 2 kişi olduğunda peer setup başlat
    if (userCount === 2) {
        setTimeout(() => {
            console.log(`🔗 2 kişi için bağlantı kuruluyor...`);
            
            roomUsers.forEach(user => {
                const otherUsers = roomUsers.filter(u => u.id !== user.id);
                
                io.to(user.id).emit('setup-peer-connections', {
                    allUsers: otherUsers,
                    myInfo: user
                });
            });
        }, 1500); // Biraz daha uzun bekle
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
