const fs = require('fs');
const crypto = require('crypto');
const forge = require('node-forge');

console.log('🔐 HTTPS sertifikası oluşturuluyor...\n');

try {
    // node-forge ile sertifika oluştur
    const pki = forge.pki;
    
    // RSA key pair oluştur
    console.log('🔑 RSA anahtar çifti oluşturuluyor...');
    const keys = pki.rsa.generateKeyPair(2048);
    
    // Sertifika oluştur
    console.log('📜 X.509 sertifikası oluşturuluyor...');
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Date.now().toString();
    
    // Geçerlilik süresi
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    
    // Subject bilgileri
    const attrs = [{
        name: 'commonName',
        value: 'localhost'
    }, {
        name: 'countryName',
        value: 'TR'
    }, {
        shortName: 'ST',
        value: 'Istanbul'
    }, {
        name: 'localityName',
        value: 'Istanbul'
    }, {
        name: 'organizationName',
        value: 'VideoChat Dev'
    }];
    
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    
    // Extensions
    cert.setExtensions([{
        name: 'basicConstraints',
        cA: true
    }, {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
    }, {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
        codeSigning: true,
        emailProtection: true,
        timeStamping: true
    }, {
        name: 'nsCertType',
        client: true,
        server: true,
        email: true,
        objsign: true,
        sslCA: true,
        emailCA: true,
        objCA: true
    }, {
        name: 'subjectAltName',
        altNames: [{
            type: 2, // DNS
            value: 'localhost'
        }, {
            type: 2, // DNS
            value: '*.localhost'
        }, {
            type: 7, // IP
            ip: '127.0.0.1'
        }, {
            type: 7, // IP
            ip: '::1'
        }]
    }]);
    
    // MD5 yerine SHA256 kullan
    cert.sign(keys.privateKey, forge.md.sha256.create());
    
    // PEM formatına çevir
    const privateKeyPem = pki.privateKeyToPem(keys.privateKey);
    const certPem = pki.certificateToPem(cert);
    
    // Dosyalara kaydet
    fs.writeFileSync('key.pem', privateKeyPem);
    fs.writeFileSync('cert.pem', certPem);
    
    console.log('\n✅ Sertifikalar başarıyla oluşturuldu!');
    console.log('📁 Oluşturulan dosyalar:');
    console.log('   - key.pem  (Private key)');
    console.log('   - cert.pem (Certificate)');
    
    // IP adreslerini göster
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    console.log('\n🌐 Sunucuya erişim adresleri:');
    console.log('   - https://localhost:3000');
    
    Object.keys(networkInterfaces).forEach((interfaceName) => {
        networkInterfaces[interfaceName].forEach((interface) => {
            if (interface.family === 'IPv4' && !interface.internal) {
                console.log(`   - https://${interface.address}:3000`);
            }
        });
    });
    
    console.log('\n⚠️  İlk bağlantıda tarayıcı güvenlik uyarısı verecek.');
    console.log('    "Gelişmiş" → "localhost\'a ilerle (güvenli değil)" seçeneğini kullanın.');
    console.log('\n🚀 Şimdi "npm start" ile sunucuyu başlatabilirsiniz!');
    
} catch (error) {
    console.error('\n❌ Hata:', error.message);
    console.log('\n📌 node-forge paketi yüklü değil. Yüklemek için:');
    console.log('   npm install node-forge');
}