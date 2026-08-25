// Global state
let currentUser = null;
let currentServer = null;
let currentChannel = null;
let socket = null;
let mediaStream = null;
let isRecording = false;
let audioRecorder = null;
let audioChunks = [];
let callActive = false;
let currentCallId = null;
let peerConnections = {};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    checkSession();
});

// Auth functions
function initAuth() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if (btn.dataset.tab === 'login') {
                loginForm.classList.remove('hidden');
                registerForm.classList.add('hidden');
            } else {
                loginForm.classList.add('hidden');
                registerForm.classList.remove('hidden');
            }
        });
    });

    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            localStorage.setItem('user', JSON.stringify(data.user));
            showApp();
        } else {
            alert(data.error);
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Ошибка входа');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        if (data.success) {
            alert(`Регистрация успешна! Ваш тег: ${data.tag}`);
            document.querySelector('[data-tab="login"]').click();
        } else {
            alert(data.error);
        }
    } catch (error) {
        console.error('Register error:', error);
        alert('Ошибка регистрации');
    }
}

function checkSession() {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showApp();
    }
}

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    
    updateUserInfo();
    initSocket();
    loadServers();
    setupEventListeners();
}

function updateUserInfo() {
    document.getElementById('current-username').textContent = currentUser.username;
    document.getElementById('current-user-tag').textContent = currentUser.tag;
    
    const avatar = document.getElementById('current-user-avatar');
    if (currentUser.avatar) {
        avatar.style.backgroundImage = `url(${currentUser.avatar})`;
        avatar.style.backgroundSize = 'cover';
        avatar.textContent = '';
    } else {
        avatar.textContent = currentUser.username[0].toUpperCase();
    }
    
    // Settings form
    document.getElementById('settings-username').value = currentUser.username;
    document.getElementById('settings-email').value = currentUser.email;
    document.getElementById('settings-status').value = currentUser.status;
    document.getElementById('settings-avatar').value = currentUser.avatar || '';
}

// Socket.IO
function initSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('join_channel', { channel_id: currentChannel?.id || 1 });
    });
    
    socket.on('new_message', (message) => {
        addMessage(message);
        scrollToBottom();
    });
    
    socket.on('user_typing', (data) => {
        const indicator = document.getElementById('typing-indicator');
        indicator.textContent = `${data.username} печатает...`;
        setTimeout(() => { indicator.textContent = ''; }, 2000);
    });
    
    socket.on('call_started', (data) => {
        if (data.initiator_id !== currentUser.id) {
            showIncomingCall(data);
        }
    });
    
    socket.on('user_joined_call', (data) => {
        addCallParticipant(data.user_id);
    });
    
    socket.on('user_left_call', (data) => {
        removeCallParticipant(data.user_id);
    });
    
    socket.on('offer', async (data) => {
        await handleOffer(data);
    });
    
    socket.on('answer', async (data) => {
        await handleAnswer(data);
    });
    
    socket.on('ice_candidate', async (data) => {
        await handleIceCandidate(data);
    });
}

// Server and Channel loading
async function loadServers() {
    try {
        const response = await fetch('/api/servers');
        const servers = await response.json();
        
        const container = document.getElementById('servers-container');
        container.innerHTML = '';
        
        if (servers.length > 0) {
            currentServer = servers[0];
            loadChannels(currentServer.id);
            
            servers.forEach(server => {
                const icon = document.createElement('div');
                icon.className = 'server-icon';
                icon.textContent = server.name[0].toUpperCase();
                icon.title = server.name;
                icon.onclick = () => selectServer(server);
                container.appendChild(icon);
            });
        }
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

async function loadChannels(serverId) {
    try {
        const response = await fetch(`/api/server/${serverId}/channels`);
        const channels = await response.json();
        
        const container = document.getElementById('channels-container');
        container.innerHTML = '';
        
        channels.forEach(channel => {
            const item = document.createElement('div');
            item.className = 'channel-item';
            item.innerHTML = `
                <span class="channel-prefix">${channel.type === 'voice' ? '[V]' : '#'}</span>
                <span>${channel.name}</span>
            `;
            item.onclick = () => selectChannel(channel);
            container.appendChild(item);
        });
        
        if (channels.length > 0 && !currentChannel) {
            selectChannel(channels[0]);
        }
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}

function selectServer(server) {
    currentServer = server;
    currentChannel = null;
    document.getElementById('server-name').textContent = server.name;
    loadChannels(server.id);
}

async function selectChannel(channel) {
    currentChannel = channel;
    
    // Update UI
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.closest('.channel-item')?.classList.add('active');
    
    document.getElementById('channel-name').textContent = channel.name;
    document.getElementById('message-input').placeholder = `Отправить сообщение в #${channel.name}`;
    
    // Load messages
    await loadMessages(channel.id);
    
    // Join channel room
    socket.emit('join_channel', { channel_id: channel.id });
    
    // Load members for text channels
    if (channel.type === 'text') {
        loadMembers();
    }
}

async function loadMessages(channelId) {
    try {
        const response = await fetch(`/api/channel/${channelId}/messages`);
        const messages = await response.json();
        
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        
        messages.forEach(message => {
            addMessage(message);
        });
        
        scrollToBottom();
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function addMessage(message) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    div.className = 'message';
    
    const time = new Date(message.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const avatarInitial = message.username[0]?.toUpperCase() || '?';
    
    if (message.is_voice) {
        div.innerHTML = `
            <div class="message-avatar">${avatarInitial}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${message.username}</span>
                    <span class="message-tag">${message.tag}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="voice-message">
                    <button class="voice-play-btn" onclick="playVoiceMessage(this, '${message.voice_data}')">></button>
                    <div class="voice-waveform"></div>
                    <span class="voice-duration">${formatDuration(message.voice_duration)}</span>
                </div>
            </div>
        `;
    } else {
        div.innerHTML = `
            <div class="message-avatar">${avatarInitial}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author">${message.username}</span>
                    <span class="message-tag">${message.tag}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-text">${escapeHtml(message.content)}</div>
            </div>
        `;
    }
    
    container.appendChild(div);
}

function playVoiceMessage(btn, voiceData) {
    if (!voiceData) return;
    
    const audio = new Audio(voiceData);
    audio.play();
    
    btn.textContent = '||';
    audio.onended = () => { btn.textContent = '>'; };
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

async function loadMembers() {
    // For now, show current user and bot
    const container = document.getElementById('members-container');
    container.innerHTML = '';
    
    const members = [
        { id: currentUser.id, username: currentUser.username, status: currentUser.status, avatar: currentUser.avatar },
        { id: 1, username: 'GigeonBot', status: 'online', avatar: '' }
    ];
    
    members.forEach(member => {
        const item = document.createElement('div');
        item.className = 'member-item';
        const initial = member.username[0]?.toUpperCase() || '?';
        item.innerHTML = `
            <div class="member-avatar">
                ${initial}
                <div class="status-indicator ${member.status}"></div>
            </div>
            <span class="member-name">${member.username}</span>
        `;
        container.appendChild(item);
    });
}

// Message sending
function setupEventListeners() {
    const sendBtn = document.getElementById('send-message-btn');
    const messageInput = document.getElementById('message-input');
    const voiceRecordBtn = document.getElementById('voice-record-btn');
    
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    messageInput.addEventListener('input', () => {
        socket.emit('typing', { channel_id: currentChannel?.id });
    });
    
    voiceRecordBtn.addEventListener('mousedown', startRecording);
    voiceRecordBtn.addEventListener('mouseup', stopRecording);
    voiceRecordBtn.addEventListener('mouseleave', stopRecording);
    
    // Call buttons
    document.getElementById('start-voice-call').addEventListener('click', () => startCall('voice'));
    document.getElementById('start-video-call').addEventListener('click', () => startCall('video'));
    
    // Settings
    document.getElementById('open-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('hidden');
    });
    document.getElementById('close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
    });
    document.getElementById('save-settings').addEventListener('click', saveSettings);
    
    // Settings navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.section}-section`).classList.add('active');
        });
    });
    
    // Call controls
    document.getElementById('end-call').addEventListener('click', endCall);
    document.getElementById('leave-call').addEventListener('click', leaveCall);
    document.getElementById('toggle-mic').addEventListener('click', toggleMic);
    document.getElementById('toggle-camera').addEventListener('click', toggleCamera);
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentChannel) return;
    
    socket.emit('send_message', {
        content,
        channel_id: currentChannel.id
    });
    
    input.value = '';
}

// Voice recording
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        audioRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        audioRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
                const base64Audio = reader.result;
                const duration = Math.floor(audioChunks.length / 10); // Approximate
                
                socket.emit('send_message', {
                    content: 'Голосовое сообщение',
                    channel_id: currentChannel.id,
                    is_voice: true,
                    voice_duration: duration,
                    voice_data: base64Audio
                });
            };
        };
        
        audioRecorder.start();
        isRecording = true;
        document.getElementById('voice-record-btn').style.color = '#ed4245';
    } catch (error) {
        console.error('Error starting recording:', error);
        alert('Не удалось получить доступ к микрофону');
    }
}

function stopRecording() {
    if (!isRecording || !audioRecorder) return;
    
    audioRecorder.stop();
    audioRecorder.stream.getTracks().forEach(track => track.stop());
    isRecording = false;
    document.getElementById('voice-record-btn').style.color = '';
}

// Calls
async function startCall(type) {
    if (!currentChannel) return;
    
    try {
        const constraints = {
            audio: true,
            video: type === 'video'
        };
        
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        socket.emit('start_call', {
            channel_id: currentChannel.id,
            call_type: type
        });
        
        showCallModal(type);
        callActive = true;
        
        // Show local video
        if (type === 'video') {
            const videoContainer = document.createElement('div');
            videoContainer.className = 'participant-card';
            videoContainer.innerHTML = `
                <div class="participant-video">
                    <video autoplay muted playsinline></video>
                </div>
                <div class="participant-name">${currentUser.username} (Вы)</div>
            `;
            videoContainer.querySelector('video').srcObject = mediaStream;
            document.getElementById('call-participants').appendChild(videoContainer);
        }
        
    } catch (error) {
        console.error('Error starting call:', error);
        alert('Не удалось начать звонок');
    }
}

function showCallModal(type) {
    const modal = document.getElementById('call-modal');
    const title = document.getElementById('call-title');
    title.textContent = type === 'video' ? 'Видеозвонок' : 'Голосовой звонок';
    modal.classList.remove('hidden');
}

function showIncomingCall(callData) {
    if (confirm(`Входящий ${callData.type === 'video' ? 'видео' : 'голосовой'} звонок. Принять?`)) {
        startCall(callData.type);
        currentCallId = callData.call_id;
        socket.emit('join_call', {
            call_id: callData.call_id,
            channel_id: callData.channel_id
        });
    }
}

function addCallParticipant(userId) {
    // Add participant to call UI
    console.log('User joined call:', userId);
}

function removeCallParticipant(userId) {
    // Remove participant from call UI
    console.log('User left call:', userId);
}

async function handleOffer(data) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    peerConnections[data.sender_id] = pc;
    
    pc.ontrack = (event) => {
        const videoEl = document.querySelector(`#participant-${data.sender_id} video`);
        if (videoEl) {
            videoEl.srcObject = event.streams[0];
        }
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                call_id: currentCallId,
                candidate: event.candidate,
                target_id: data.sender_id
            });
        }
    };
    
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('answer', {
        call_id: currentCallId,
        answer: pc.localDescription,
        target_id: data.sender_id
    });
}

async function handleAnswer(data) {
    const pc = peerConnections[data.sender_id];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
}

async function handleIceCandidate(data) {
    const pc = peerConnections[data.sender_id];
    if (pc && data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

function endCall() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    
    document.getElementById('call-modal').classList.add('hidden');
    document.getElementById('call-participants').innerHTML = '';
    callActive = false;
    currentCallId = null;
    
    if (currentChannel) {
        socket.emit('leave_call', {
            call_id: currentCallId,
            channel_id: currentChannel.id
        });
    }
}

function leaveCall() {
    endCall();
}

function toggleMic() {
    if (mediaStream) {
        const audioTrack = mediaStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            document.getElementById('toggle-mic').classList.toggle('active', audioTrack.enabled);
        }
    }
}

function toggleCamera() {
    if (mediaStream) {
        const videoTrack = mediaStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            document.getElementById('toggle-camera').classList.toggle('active', videoTrack.enabled);
        }
    }
}

// Settings
async function saveSettings() {
    const updates = {
        username: document.getElementById('settings-username').value,
        email: document.getElementById('settings-email').value,
        status: document.getElementById('settings-status').value,
        avatar: document.getElementById('settings-avatar').value
    };
    
    try {
        const response = await fetch(`/api/user/${currentUser.id}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        const data = await response.json();
        if (data.success) {
            currentUser = { ...currentUser, ...updates };
            localStorage.setItem('user', JSON.stringify(currentUser));
            updateUserInfo();
            document.getElementById('settings-modal').classList.add('hidden');
            alert('Настройки сохранены');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Ошибка сохранения настроек');
    }
}

// Utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Device Detection and Mobile UI
function detectDevice() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     (window.innerWidth <= 768);
    
    if (isMobile) {
        document.body.classList.remove('desktop-body');
        document.body.classList.add('mobile-body');
    } else {
        document.body.classList.remove('mobile-body');
        document.body.classList.add('desktop-body');
    }
    
    return isMobile;
}

// Mobile UI functions
function initMobileUI() {
    const menuToggle = document.getElementById('menu-toggle');
    const sidebarClose = document.getElementById('sidebar-close');
    const channelsSidebar = document.getElementById('channels-sidebar');
    const mobileMembersBtn = document.getElementById('mobile-members-btn');
    const membersPanel = document.getElementById('mobile-members-panel');
    const membersPanelClose = document.getElementById('members-panel-close');
    const navItems = document.querySelectorAll('.nav-item');
    
    // Menu toggle
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            channelsSidebar.classList.toggle('open');
        });
    }
    
    // Sidebar close
    if (sidebarClose) {
        sidebarClose.addEventListener('click', () => {
            channelsSidebar.classList.remove('open');
        });
    }
    
    // Members panel
    if (mobileMembersBtn) {
        mobileMembersBtn.addEventListener('click', () => {
            membersPanel.classList.toggle('open');
        });
    }
    
    if (membersPanelClose) {
        membersPanelClose.addEventListener('click', () => {
            membersPanel.classList.remove('open');
        });
    }
    
    // Bottom navigation
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            const navType = item.dataset.nav;
            
            if (navType === 'channels') {
                channelsSidebar.classList.add('open');
                membersPanel.classList.remove('open');
            } else if (navType === 'members') {
                membersPanel.classList.add('open');
                channelsSidebar.classList.remove('open');
            } else if (navType === 'home') {
                channelsSidebar.classList.remove('open');
                membersPanel.classList.remove('open');
                // Navigate to home/server list
                loadServers();
            }
        });
    });
    
    // Close panels when clicking outside
    document.addEventListener('click', (e) => {
        if (!channelsSidebar.contains(e.target) && !menuToggle?.contains(e.target)) {
            channelsSidebar.classList.remove('open');
        }
        if (!membersPanel.contains(e.target) && !mobileMembersBtn?.contains(e.target)) {
            membersPanel.classList.remove('open');
        }
    });
}

// Update showApp function to include mobile detection
const originalShowApp = showApp;
showApp = function() {
    originalShowApp();
    detectDevice();
    initMobileUI();
    
    // Listen for window resize
    window.addEventListener('resize', () => {
        detectDevice();
    });
};

// Also update loadMembers to populate mobile members container
const originalLoadMembers = loadMembers;
loadMembers = function() {
    originalLoadMembers();
    
    // Clone members to mobile panel
    const container = document.getElementById('members-container');
    const mobileContainer = document.getElementById('mobile-members-container');
    
    if (container && mobileContainer) {
        mobileContainer.innerHTML = container.innerHTML;
    }
};

// Run device detection on load
document.addEventListener('DOMContentLoaded', () => {
    detectDevice();
    
    window.addEventListener('resize', () => {
        detectDevice();
    });
});
