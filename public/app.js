const socket = io();
let localStream;
let peerConnection;
let currentRoomId;
let myUsername;

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// UI Elementleri
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

const userListUI = document.getElementById('user-list');
const chatMessagesUI = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

function showAppScreen() {
    entryScreen.style.display = 'none';
    appScreen.style.display = 'flex';
}

function validateName() {
    myUsername = usernameInput.value.trim();
    if (!myUsername) { alert("Lütfen önce bir isim gir kanka!"); return false; }
    return true;
}

// 1. ODA KURMA
createBtn.addEventListener('click', () => {
    if(!validateName()) return;
    currentRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    generatedCodeDisplay.innerText = currentRoomId;
    socket.emit('join-room', { roomId: currentRoomId, username: myUsername });
    showAppScreen();
});

// 2. ODAYA KATILMA
joinBtn.addEventListener('click', () => {
    if(!validateName()) return;
    const code = roomInput.value.trim().toUpperCase();
    if (code.length === 4) {
        currentRoomId = code;
        generatedCodeDisplay.innerText = currentRoomId;
        socket.emit('join-room', { roomId: currentRoomId, username: myUsername });
        showAppScreen();
        createPeerConnection(null);
    } else {
        alert('Oda kodu 4 haneli olmalı.');
    }
});

// 3. EKRAN PAYLAŞ
startShareBtn.addEventListener('click', async () => {
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
        startShareBtn.style.display = 'none';
        stopShareBtn.style.display = 'block';
        
        // Eğer odada zaten biri varsa direkt ona bağlan
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

// 4. MANUEL YENİLEME TUŞU (Bağlantı Tetikleyici)
refreshBtn.addEventListener('click', () => {
    // Tüm odaya "Bağlantıyı Yenile" sinyali at
    socket.emit('force-refresh');
    
    // İzleyiciysen kendi alıcını sıfırla
    if(!localStream) {
        if(peerConnection) { peerConnection.close(); peerConnection = null; }
        createPeerConnection(null);
    }
});

// ÇIKIŞ
leaveBtn.addEventListener('click', () => location.reload());

// --- CHAT VE KULLANICI LİSTESİ ---
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
    chatMessagesUI.scrollTop = chatMessagesUI.scrollHeight; // Otomatik aşağı kaydır
});

// --- WEBRTC MOTORU ---
function createPeerConnection(targetPeerId) {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { roomId: currentRoomId, to: targetPeerId, signal: { type: 'candidate', candidate: event.candidate } });
        }
    };

    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) { remoteVideo.srcObject = event.streams[0]; }
    };
}

// Biri odaya girdiğinde veya "Yenile" tuşuna basıldığında
socket.on('peer-joined', handleResync);
socket.on('force-refresh', handleResync);

async function handleResync(viewerPeerId) {
    // Eğer yayıncıysan yeni Offer oluşturup gönder
    if (localStream) {
        if(peerConnection) { peerConnection.close(); peerConnection = null; }
        createPeerConnection(viewerPeerId);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('signal', { roomId: currentRoomId, to: viewerPeerId, signal: { type: 'offer', sdp: offer.sdp } });
    }
}

socket.on('signal', async (data) => {
    if (!peerConnection) createPeerConnection(data.sender);
    const { signal, sender } = data;

    if (signal.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { roomId: currentRoomId, to: sender, signal: { type: 'answer', sdp: answer.sdp } });
    }
    else if (signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
    }
    else if (signal.type === 'candidate' && signal.candidate) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (e) { }
    }
});