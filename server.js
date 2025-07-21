const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios'); // Untuk permintaan HTTP ke Twilio/Telegram API
require('dotenv').config(); // Memuat variabel lingkungan dari file .env

const app = express();
// PASTIKAN PORT DI SINI SESUAI DENGAN .ENV (8001)
// Jika .env punya PORT=8001, maka ini akan menjadi 8001. Jika tidak ada di .env, akan jadi 8000.
// Dari log sebelumnya, server berjalan di 8001, jadi ini harusnya sudah benar.
const PORT = process.env.PORT || 8001; // <-- Ubah fallback ke 8001 agar konsisten jika .env tidak terbaca


// Middleware
app.use(cors({
    origin: ['http://localhost:8001', 'http://127.0.0.1:5500', 'http://localhost:5500'], // Sesuaikan dengan domain frontend Anda
    credentials: true
}));
app.use(express.json()); // Middleware untuk parsing body JSON

// Konfigurasi Email (Gmail)
let emailTransporter;
try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('⚠️ Variabel lingkungan EMAIL_USER atau EMAIL_PASS tidak diatur untuk Nodemailer.');
    } else {
        emailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS // App Password, bukan password biasa
            },
            // Opsi debug (opsional)
            // logger: true,
            // debug: true
        });
        // Verifikasi koneksi saat startup
        emailTransporter.verify(function(error, success) {
            if (error) {
                console.error("❌ Email transporter verification failed:", error);
            } else {
                console.log("✅ Email transporter is ready to send messages");
            }
        });
    }
} catch (e) {
    console.error("❌ Error creating email transporter:", e.message);
}


// Fungsi untuk memvalidasi email (simple)
const isValidEmail = (email) => {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Endpoint untuk mengirim notifikasi
app.post('/api/send-notification', async (req, res) => {
    try {
        // PERUBAHAN UTAMA DI SINI: Destructure objek 'recipients' secara langsung
        const { subject, message, channels, recipients } = req.body;

        // Validasi dasar
        if (!subject || !message || !channels || !Array.isArray(channels) || channels.length === 0) {
            console.error('Validation Error: Data notifikasi tidak lengkap atau format channels salah.', req.body);
            return res.status(400).json({
                success: false,
                message: 'Subjek, pesan, dan saluran harus diisi.'
            });
        }

        const results = [];

        // --- Kirim Email ---
        if (channels.includes('email')) {
            // Gunakan recipients.email yang dikirim dari frontend
            const currentEmailRecipient = recipients?.email; // Menggunakan optional chaining untuk keamanan
            
            // From: hcsi.sbi@gmail.com
            // To: hcscsbi9@gmail.com

            if (emailTransporter && isValidEmail(currentEmailRecipient)) {
                try {
                    const mailOptions = {
                        from: {
                            name: 'Anomaly Insight System',
                            address: process.env.EMAIL_USER // <-- Ini akan menjadi hcsi.sbi@gmail.com dari .env
                        },
                        to: currentEmailRecipient, // <-- Ini akan menjadi hcscsbi9@gmail.com dari frontend payload
                        subject: `[Anomaly Insight] ${subject}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
                                <h2 style="color: #333; margin-bottom: 20px;">Notifikasi dari Solusi Bangun Indonesia</h2>
                                <div style="background-color: white; padding: 20px; border-radius: 5px; border-left: 4px solid #007bff;">
                                <h3 style="color: #333; margin-top: 0;">${subject}</h3>
                                <p style="color: #666; line-height: 1.6;">${message}</p>
                                </div>
                                <div style="margin-top: 20px; font-size: 12px; color: #888;">
                                <p>Pesan ini dikirim secara otomatis oleh sistem Solusi Bangun Indonesia.</p>
                                </div>
                            </div>
                            </div>
                        `
                    };
                    const info = await emailTransporter.sendMail(mailOptions);
                    results.push({ channel: 'email', status: 'success', messageId: info.messageId });
                    console.log(`✅ Email berhasil dikirim ke ${currentEmailRecipient}: ${info.messageId}`);
                } catch (error) {
                    let errorMessage = 'Gagal mengirim email.';
                    if (error.code === 'EAUTH') {
                        errorMessage = 'Autentikasi email gagal. Periksa username dan App Password Gmail di .env.';
                    } else if (error.code === 'EENVELOPE' || error.responseCode === 553) {
                        errorMessage = `Alamat email pengirim/penerima tidak valid: ${currentEmailRecipient}.`;
                    } else if (error.code === 'ECONNECTION') {
                        errorMessage = 'Gagal terhubung ke server email. Periksa koneksi internet atau pengaturan SMTP.';
                    }
                    results.push({ channel: 'email', status: 'failed', error: errorMessage + ' ' + error.message });
                    console.error(`❌ Gagal mengirim email ke ${currentEmailRecipient}:`, error);
                }
            } else {
                results.push({ channel: 'email', status: 'skipped', error: 'Email transporter tidak dikonfigurasi atau penerima tidak valid.' });
                console.warn('⚠️ Email pengiriman dilewati: Transporter tidak siap atau penerima tidak valid.');
            }
        }

        // --- Kirim WhatsApp (menggunakan Twilio WhatsApp API) ---
        if (channels.includes('whatsapp')) {
            const currentWhatsappRecipient = recipients?.whatsapp; // Menggunakan optional chaining
            if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && currentWhatsappRecipient) {
                try {
                    const whatsappMessage = `*${subject}*\n\n${message}\n\n_Dikirim dari Solusi Bangun Indonesia_`;
                    
                    const twilioResponse = await axios.post(
                        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
                        new URLSearchParams({
                            From: process.env.TWILIO_WHATSAPP_FROM,
                            To: `whatsapp:${currentWhatsappRecipient}`,
                            Body: whatsappMessage
                        }),
                        {
                            auth: {
                                username: process.env.TWILIO_ACCOUNT_SID,
                                password: process.env.TWILIO_AUTH_TOKEN
                            },
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded'
                            }
                        }
                    );
                    
                    results.push({ 
                        channel: 'whatsapp', 
                        status: 'success',
                        messageId: twilioResponse.data.sid 
                    });
                    console.log(`✅ WhatsApp berhasil dikirim ke ${currentWhatsappRecipient}: ${twilioResponse.data.sid}`);
                } catch (error) {
                    const errorMessage = error.response?.data?.message || error.message;
                    results.push({ 
                        channel: 'whatsapp', 
                        status: 'failed', 
                        error: `Twilio Error: ${errorMessage}` 
                    });
                    console.error(`❌ Gagal mengirim WhatsApp ke ${currentWhatsappRecipient}:`, error.response?.data || error);
                }
            } else {
                results.push({ channel: 'whatsapp', status: 'skipped', error: 'Twilio kredensial atau nomor penerima WhatsApp tidak diatur.' });
                console.warn('⚠️ WhatsApp pengiriman dilewati: Kredensial Twilio tidak lengkap atau penerima tidak ada.');
            }
        }

        // --- Kirim Telegram ---
        if (channels.includes('telegram')) {
            const currentTelegramChatId = recipients?.telegram; // Menggunakan optional chaining
            if (process.env.TELEGRAM_BOT_TOKEN && currentTelegramChatId && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token') {
                try {
                    const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
                    await axios.post(telegramUrl, {
                        chat_id: currentTelegramChatId,
                        text: `*${subject}*\n\n${message}` // Format Markdown
                    });
                    results.push({ channel: 'telegram', status: 'success' });
                    console.log(`✅ Telegram berhasil dikirim ke chat ID ${currentTelegramChatId}`);
                } catch (error) {
                    const errorMessage = error.response?.data?.description || error.message;
                    results.push({ channel: 'telegram', status: 'failed', error: `Telegram Error: ${errorMessage}` });
                    console.error(`❌ Gagal mengirim Telegram ke chat ID ${currentTelegramChatId}:`, error.response?.data || error);
                }
            } else {
                results.push({ channel: 'telegram', status: 'skipped', error: 'Token bot Telegram atau chat ID tidak dikonfigurasi.' });
                console.warn('⚠️ Telegram pengiriman dilewati: Token bot atau chat ID tidak lengkap.');
            }
        }


        // Tentukan pesan respons berdasarkan hasil pengiriman
        const successChannels = results.filter(r => r.status === 'success').map(r => r.channel);
        const failedChannels = results.filter(r => r.status === 'failed').map(r => r.channel);
        const skippedChannels = results.filter(r => r.status === 'skipped').map(r => r.channel);

        let finalMessage = 'Notifikasi berhasil diproses.';
        if (successChannels.length > 0) {
            finalMessage += ` Terkirim melalui: ${successChannels.join(', ')}.`;
        }
        if (failedChannels.length > 0) {
            finalMessage += ` Gagal pada: ${failedChannels.join(', ')}.`;
        }
        if (skippedChannels.length > 0) {
            finalMessage += ` Dilewati pada: ${skippedChannels.join(', ')}.`;
        }

        // Status code 200 jika setidaknya ada satu yang sukses, atau semua dilewati
        if (successChannels.length > 0) {
            res.status(200).json({
                success: true,
                message: finalMessage,
                results: results
            });
        } else if (failedChannels.length > 0) {
            // Jika ada yang gagal tapi tidak ada yang sukses, kembalikan 400 atau 500
            res.status(400).json({
                success: false,
                message: finalMessage,
                results: results
            });
        } else {
            // Semua dilewati atau tidak ada channel yang diminta
            res.status(200).json({
                success: true,
                message: finalMessage || 'Tidak ada notifikasi yang dikirim. Periksa channel yang diminta atau konfigurasi.',
                results: results
            });
        }

    } catch (error) {
        console.error('Unhandled Server Error in /api/send-notification:', error);
        res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan internal server saat memproses notifikasi.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Endpoint untuk test koneksi
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Backend server berjalan dengan baik',
        timestamp: new Date().toISOString()
    });
});

// Endpoint untuk mendapatkan status konfigurasi notifikasi (untuk debugging frontend)
app.get('/api/notifications/status', (req, res) => {
    res.json({
        success: true,
        services: {
            email: process.env.EMAIL_USER ? 'configured' : 'not configured',
            whatsapp: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM ? 'configured' : 'not configured',
            telegram: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token' ? 'configured' : 'not configured'
        }
    });
});


// Start server
app.listen(PORT, () => {
    console.log(`✅ Server berjalan di http://localhost:${PORT}`);
    console.log(`📧 Email service: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured'}`);
    console.log(`📱 WhatsApp service: ${process.env.TWILIO_ACCOUNT_SID ? 'Configured' : 'Not configured'}`);
    console.log(`💬 Telegram service: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
});

module.exports = app;