const socket = io();
let localStream;
let currentRoomId;
let myUsername;
let isOwner = false;

// ÇOKLU İZLEYİCİ İÇİN BORU LİSTESİ
const peers = {}; 

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

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        roomInput.value = roomFromUrl;
        usernameInput.focus();
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

createBtn.addEventListener('click', () => {
    if(!validateName()) return;
    isOwner = true;
    currentRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    generatedCodeDisplay.innerText = currentRoomId;
    startShareBtn.style.display = 'block';
    socket.emit('join-room', { roomId: currentRoomId, username: myUsername });
    showAppScreen();
});

joinBtn.addEventListener('click', () => {
    if(!validateName()) return;
    const code = roomInput.value.trim().toUpperCase();
    if (code.length === 4) {
        isOwner = false;
        currentRoomId = code;
        generatedCodeDisplay.innerText = currentRoomId;
        startShareBtn.style.display = 'none';
        stopShareBtn.style.display = 'none';
        socket.emit('join-room', { roomId: currentRoomId, username: myUsername });
        showAppScreen();
    } else { alert('Oda kodu 4 haneli olmalı.'); }
});

copyLinkBtn.addEventListener('click', () => {
    const link = `${window.location.origin}?room=${currentRoomId}`;
    navigator.clipboard.writeText(link).then(() => {
        copyLinkBtn.style.color = '#00ff88';
        copyLinkBtn.style.borderColor = 'rgba(0, 255, 136, 0.5)';
        setTimeout(() => {
            copyLinkBtn.style.color = '#b026ff';
            copyLinkBtn.style.borderColor = 'rgba(176, 38, 255, 0.5)';
        }, 2000);
    });
});

// YENİ: 1080P 60FPS NİTRO KALİTESİ ZORLAMASI
startShareBtn.addEventListener('click', async () => {
    if (!isOwner) return;
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { 
                cursor: "always",
                frameRate: { ideal: 60, max: 60 },
                width: { ideal: 1920, max: 3840 },
                height: { ideal: 1080, max: 2160 }
            }, 
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                sampleRate: 48000
            } 
        });
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
    // Herkesin borusunu kapat
    Object.keys(peers).forEach(peerId => {
        peers[peerId].close();
        delete peers[peerId];
    });
}
stopShareBtn.addEventListener('click', stopScreenShare);

refreshBtn.addEventListener('click', () => { socket.emit('force-refresh'); });
leaveBtn.addEventListener('click', () => { window.location.href = window.location.origin; });

// CHAT 
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

// YENİ: ÇOKLU İZLEYİCİ İÇİN BAĞLANTI OLUŞTURUCU
function createPeerConnection(targetPeerId) {
    if (peers[targetPeerId]) return peers[targetPeerId]; // Zaten varsa yenisini açma

    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetPeerId] = pc;

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { roomId: currentRoomId, to: targetPeerId, signal: { type: 'candidate', candidate: event.candidate } });
        }
    };

    pc.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) { 
            remoteVideo.srcObject = event.streams[0]; 
            remoteVideo.play().catch(e => console.log(e));
        }
    };

    return pc;
}

// Biri odadan çıkarsa onun borusunu iptal et (İnterneti rahatlat)
socket.on('peer-left', (peerId) => {
    if(peers[peerId]) {
        peers[peerId].close();
        delete peers[peerId];
    }
});

socket.on('peer-joined', handleResync);
socket.on('force-refresh', handleResync);

async function handleResync(viewerPeerId) {
    // Kurucuyken yeni biri girdiyse veya yenilendiyse O KİŞİYE ÖZEL boru aç
    if (localStream && isOwner && viewerPeerId) {
        if(peers[viewerPeerId]) { peers[viewerPeerId].close(); delete peers[viewerPeerId]; }
        
        const pc = createPeerConnection(viewerPeerId);
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal', { roomId: currentRoomId, to: viewerPeerId, signal: { type: 'offer', sdp: offer.sdp } });
    }
}

socket.on('signal', async (data) => {
    const { signal, sender } = data;
    const pc = createPeerConnection(sender);

    if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { roomId: currentRoomId, to: sender, signal: { type: 'answer', sdp: answer.sdp } });
    }
    else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
    }
    else if (signal.type === 'candidate' && signal.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (e) { }
    }
});
