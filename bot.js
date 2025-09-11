document.addEventListener('DOMContentLoaded', () => {
    // Global variables
    const statusEl = document.getElementById("status");
    const loadingEl = document.getElementById("loading");
    const textInput = document.getElementById("textInput");
    const audio = document.getElementById("audio");
    const chatArea = document.getElementById("chatArea");
    const micBtn = document.getElementById("micBtn");
    const sendBtn = document.getElementById("sendBtn");
    const newChatBtn = document.querySelector(".new-chat-btn");
    const voiceStatus = document.getElementById("voiceStatus");

    let mediaSource = new MediaSource();
    let sourceBuffer;
    let queue = [];
    let ws;
    let sessionId = null;
    let currentIntent = null;
    let lastUserMessage = null; // To store the last message before auth
    let isRecording = false;
    let recognition;

    // Initialize audio
    audio.src = URL.createObjectURL(mediaSource);

    // WebSocket initialization
    function initializeWebSocket() {
        if (ws && ws.readyState === WebSocket.OPEN) return;
        
        updateConnectionStatus("connecting");
        ws = new WebSocket("ws://34.0.5.211:8000/ws/stream");
        ws.binaryType = "arraybuffer";

        ws.onopen = () => updateConnectionStatus("connected");
        ws.onclose = () => updateConnectionStatus("disconnected");
        ws.onerror = () => updateConnectionStatus("error");
        ws.onmessage = handleWebSocketMessage;
    }

    // Update connection status with modern styling
    function updateConnectionStatus(status) {
        const indicator = statusEl.querySelector('.indicator');
        const text = statusEl.querySelector('span');
        
        indicator.className = 'indicator'; // Reset classes

        switch(status) {
            case "connected":
                indicator.classList.add('connected');
                text.textContent = "Connected";
                break;
            case "disconnected":
                indicator.classList.add('disconnected');
                text.textContent = "Disconnected";
                break;
            case "error":
                indicator.classList.add('error');
                text.textContent = "Connection Error";
                break;
            default:
                indicator.classList.add('connecting');
                text.textContent = "Connecting...";
        }
    }

    // MediaSource setup
    mediaSource.addEventListener("sourceopen", () => {
        if (!sourceBuffer) {
            sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
            sourceBuffer.mode = "sequence";
            sourceBuffer.addEventListener("updateend", () => {
                if (queue.length > 0 && !sourceBuffer.updating) {
                    sourceBuffer.appendBuffer(queue.shift());
                }
            });
        }
    });

    // Handle WebSocket messages
    function handleWebSocketMessage(event) {
        if (event.data instanceof ArrayBuffer) {
            loadingEl.classList.add("hidden");
            if (sourceBuffer && (sourceBuffer.updating || queue.length > 0)) {
                queue.push(event.data);
            } else if (sourceBuffer) {
                sourceBuffer.appendBuffer(event.data);
            }
        } else {
            const message = JSON.parse(event.data);
            switch(message.type) {
                case "session":
                    sessionId = message.session_id;
                    break;
                case "auth_required":
                    sessionId = message.SID;
                    currentIntent = message.intent;
                    showAuthModal(message.message);
                    break;
                case "text":
                    addMessage(message.data, "bot");
                    break;
            }
        }
    }

    // Enhanced message display
    function addMessage(text, sender) {
        const welcomeMessage = chatArea.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        const msgDiv = document.createElement("div");
        msgDiv.classList.add("message", sender);

        const senderName = sender === 'user' ? 'You' : 'Maya';
        
        // Create sender name element
        const senderDiv = document.createElement("div");
        senderDiv.classList.add("message-sender");
        senderDiv.textContent = senderName;
        
        // Create message content element
        const contentP = document.createElement("p");
        contentP.textContent = text;
        
        // Append elements to message container
        msgDiv.appendChild(senderDiv);
        msgDiv.appendChild(contentP);
        
        chatArea.appendChild(msgDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    // Send text message
    function sendText() {
        const text = textInput.value.trim();
        if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

        // Save audio state before sending message
        const wasPlaying = !audio.paused;
        const currentTime = audio.currentTime;

        addMessage(text, "user");
        lastUserMessage = text; // Store the message before sending
        ws.send(text);
        textInput.value = "";

        // Only reset queue if we're not currently playing audio
        if (!wasPlaying) {
            queue = [];
        }
        
        loadingEl.classList.remove("hidden");

        // Only reset MediaSource if it's in an ended state and we're not playing
        if ((mediaSource.readyState === "ended" || mediaSource.readyState === "closed") && !wasPlaying) {
            mediaSource = new MediaSource();
            audio.src = URL.createObjectURL(mediaSource);
            mediaSource.dispatchEvent(new Event('sourceopen'));
        } else if (wasPlaying && audio.paused) {
            // Restore audio playback if it was interrupted
            audio.currentTime = currentTime;
            audio.play().catch(err => console.error('Error resuming audio:', err));
        }
    }

    // Event Listeners for input
    textInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendText();
        }
    });

    sendBtn.addEventListener("click", sendText);

    // Speech Recognition Setup
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.lang = "en-IN";
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => {
            isRecording = true;
            voiceStatus.textContent = "Listening...";
            micBtn.classList.add('recording');
        };

        recognition.onresult = (event) => {
            // Save audio state before processing result
            const wasPlaying = !audio.paused;
            const currentTime = audio.currentTime;
            
            const transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join('');
            textInput.value = transcript;
            
            // Use setTimeout to allow the recognition to complete before sending
            // This prevents audio interruption
            setTimeout(() => {
                sendText();
                
                // Restore audio state if needed
                if (wasPlaying && audio.paused) {
                    audio.currentTime = currentTime;
                    audio.play().catch(err => console.error('Error resuming audio:', err));
                }
            }, 100);
        };

        recognition.onerror = (event) => {
            voiceStatus.textContent = `Error: ${event.error}`;
        };

        recognition.onend = () => {
            isRecording = false;
            voiceStatus.textContent = "";
            micBtn.classList.remove('recording');
        };
    } else {
        voiceStatus.textContent = "Speech recognition not supported.";
        micBtn.disabled = true;
    }

    micBtn.addEventListener("click", () => {
        if (!recognition) return;
        
        // Save audio state before toggling recognition
        const wasPlaying = !audio.paused;
        const currentTime = audio.currentTime;
        
        if (isRecording) {
            recognition.stop();
        } else {
            recognition.start();
        }
        
        // Restore audio state if it was playing
        if (wasPlaying && audio.paused) {
            audio.currentTime = currentTime;
            audio.play().catch(err => console.error('Error resuming audio:', err));
        }
    });

    // New Chat Functionality
    newChatBtn.addEventListener("click", () => {
        chatArea.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">&#128075;</div>
                <h1>Welcome to Fincove AI</h1>
                <p>Start a conversation by typing or using your voice below.</p>
            </div>`;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "end_session", session_id: sessionId }));
            ws.close();
        }
        setTimeout(initializeWebSocket, 100);
    });

    // Authentication Functions
    const authModal = document.getElementById("authModal");
    const phoneInputDiv = document.getElementById("phoneInput");
    const otpInputDiv = document.getElementById("otpInput");
    const authStatus = document.getElementById("authStatus");

    window.showAuthModal = (message) => {
        authModal.classList.remove("hidden");
        phoneInputDiv.classList.remove("hidden");
        otpInputDiv.classList.add("hidden");
        authStatus.textContent = message;
    }

    window.sendOTP = async () => {
        const phoneEl = document.getElementById("phone");
        let phone = phoneEl.value.replace(/\D/g, '');
        if (!phone.startsWith('+')) {
            phone = `+91${phone}`;
        }

        try {
            const response = await fetch("http://34.0.5.211:8000/auth/send-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone, session_id: sessionId }),
            });
            if (response.ok) {
                phoneInputDiv.classList.add("hidden");
                otpInputDiv.classList.remove("hidden");
                authStatus.textContent = "OTP sent successfully!";
            } else {
                const error = await response.json();
                authStatus.textContent = error.detail || "Failed to send OTP";
            }
        } catch (error) {
            authStatus.textContent = "Error sending OTP.";
        }
    }

    window.verifyOTP = async () => {
        const phone = document.getElementById("phone").value;
        const otp = document.getElementById("otp").value;
        
        if (!sessionId) {
            authStatus.textContent = "Session ID not found. Please refresh.";
            return;
        }
        
        try {
            const response = await fetch("http://34.0.5.211:8000/auth/verify-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone, code: otp }),
            });

            if (response.ok) {
                const data = await response.json();
                if (data.verified) {
                    authModal.classList.add("hidden");
                    ws.send(JSON.stringify({ type: "verification_complete", session_id: sessionId }));

                    // Resend the original message that triggered auth
                    // Resend the original message that triggered auth
                    if (lastUserMessage) {
                        // No need to add the message to the UI again, as it's already there.
                        ws.send(lastUserMessage);
                        lastUserMessage = null; // Clear after sending
                    }
                }
            } else {
                const error = await response.json();
                authStatus.textContent = error.detail || "Invalid OTP.";
            }
        } catch (error) {
            authStatus.textContent = "Error verifying OTP.";
        }
    }

    // Initial load
    initializeWebSocket();
});
