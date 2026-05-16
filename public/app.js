const socket = io();
let localStream;
let peerConnection;
let currentRoomId;
let myUsername;
let isOwner = false; // YENİ: Kurucu yetkisi

const rtcConfig = { 
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
    ] 
};

const entryScreen = document.getElementById('entry-screen');
const appScreen = document.getElementById('app-screen');
const remoteVideo = document.getElementById('remote-video');

const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const generatedCodeDisplay = document.getElementById('generated-code');

const createBtn = document.getElementById('create-room-btn');
const joinBtn = document.getElementById('join-room-btn');
const startShareBtn = document.getElementById('start-share-btn');
const stopShareBtn = document.getElementById('stop-share-btn');
const refreshBtn = document.getElementById('refresh-btn');
const leaveBtn = document.getElementById('leave-btn');
const copyLinkBtn = document.getElementById('copy-link-btn');

const userListUI = document.getElementById('user-list');
const chatMessagesUI = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// YENİ: URL'den link parametresini oku ve kutuya otomatik doldur
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        roomInput.value = roomFromUrl;
        usernameInput.focus(); // Direkt isim girmesi için odaklar
    }
});

function showAppScreen() {
    entryScreen.style.display = 'none';
    appScreen.style.display = 'flex';
}

function validateName() {
    myUsername = usernameInput.value.trim();
    if (!myUsername) { alert("Lütfen önce bir isim gir kanka!"); return false; }
    return true;
}

// 1. ODA KURMA (SADECE BU KİŞİ YAYIN AÇABİLİR)
createBtn.addEventListener('click', () => {
    if(!validateName()) return;
    isOwner = true; // Kurucu yetkisi verildi
    currentRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    generatedCodeDisplay.innerText = currentRoomId;
    
    // Yayın tuşunu sadece kurucuya göster
    startShareBtn.style.display = 'block';
    
    socket.emit('join-room', { roomId: currentRoomId, username: myUsername });
    showAppScreen();
});

// 2. ODAYA KATILMA (İZLEYİCİ - YAYIN AÇAMAZ)
joinBtn.addEventListener('click', () => {
    if(!validateName()) return;
    const code = roomInput.value.trim().toUpperCase();
    if (code.length === 4) {
        isOwner = false; // İzleyici yetkisi
        currentRoomId = code;
        generatedCodeDisplay.innerText = currentRoomId;
        
        // İzleyicide yayın tuşlarını tamamen gizle
        startShareBtn.style.display = 'none';
        stopShareBtn.style.display = 'none';

        socket.emit('join-room', { roomId: currentRoomId, username: myUsername });
        showAppScreen();
    } else {
        alert('Oda kodu 4 haneli olmalı.');
    }
});

// YENİ: LİNK KOPYALAMA BUTONU
copyLinkBtn.addEventListener('click', () => {
    const link = `${window.location.origin}?room=${currentRoomId}`;
    navigator.clipboard.writeText(link).then(() => {
        // Kopyalandıktan sonra butonu yeşil yapıp onay ver
        copyLinkBtn.style.color = '#00ff88';
        copyLinkBtn.style.borderColor = 'rgba(0, 255, 136, 0.5)';
        setTimeout(() => {
            copyLinkBtn.style.color = '#b026ff';
            copyLinkBtn.style.borderColor = 'rgba(176, 38, 255, 0.5)';
        }, 2000);
    });
});

// 3. EKRAN PAYLAŞ
startShareBtn.addEventListener('click', async () => {
    if (!isOwner) return; // Güvenlik katmanı
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
        startShareBtn.style.display = 'none';
        stopShareBtn.style.display = 'block';
        socket.emit('force-refresh'); 
        localStream.getVideoTracks()[0].onended = stopScreenShare;
    } catch (err) { console.error("Ekran yakalanamadı:", err); }
});

function stopScreenShare() {
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
    startShareBtn.style.display = 'block';
    stopShareBtn.style.display = 'none';
}
stopShareBtn.addEventListener('click', stopScreenShare);

// YENİLEME VE ÇIKIŞ
refreshBtn.addEventListener('click', () => { socket.emit('force-refresh'); });
leaveBtn.addEventListener('click', () => { window.location.href = window.location.origin; });

// CHAT SİSTEMİ
socket.on('update-users', (users) => {
    userListUI.innerHTML = '';
    users.forEach(u => {
        const li = document.createElement('li');
        li.innerText = u.name + (u.id === socket.id ? " (Sen)" : "");
        userListUI.appendChild(li);
    });
});

function sendMessage() {
    const text = chatInput.value.trim();
    if(text) { socket.emit('chat-message', text); chatInput.value = ''; }
}
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') sendMessage(); });

socket.on('chat-message', (data) => {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg';
    msgDiv.innerHTML = `<b>${data.sender}:</b> ${data.text}`;
    chatMessagesUI.appendChild(msgDiv);
    chatMessagesUI.scrollTop = chatMessagesUI.scrollHeight;
});

// WEBRTC MOTORU
function createPeerConnection(targetPeerId) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { roomId: currentRoomId, to: targetPeerId, signal: { type: 'candidate', candidate: event.candidate } });
        }
    };

    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) { 
            remoteVideo.srcObject = event.streams[0]; 
            remoteVideo.play().catch(e => console.log("Otomatik oynatma engellendi, ekrana dokunun:", e));
        }
    };
}

socket.on('peer-joined', handleResync);
socket.on('force-refresh', handleResync);

async function handleResync(viewerPeerId) {
    if (localStream && isOwner) {
        if(peerConnection) { peerConnection.close(); peerConnection = null; }
        createPeerConnection(viewerPeerId);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('signal', { roomId: currentRoomId, to: viewerPeerId, signal: { type: 'offer', sdp: offer.sdp } });
    }
}

socket.on('signal', async (data) => {
    const { signal, sender } = data;

    if (signal.type === 'offer') {
        if (peerConnection) { peerConnection.close(); peerConnection = null; }
        createPeerConnection(sender);
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { roomId: currentRoomId, to: sender, signal: { type: 'answer', sdp: answer.sdp } });
    }
    else if (signal.type === 'answer') {
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
    }
    else if (signal.type === 'candidate' && signal.candidate) {
        if (!peerConnection) return;
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (e) { }
    }
});
