document.addEventListener('DOMContentLoaded', () => {
    // --- Global state and DOM references ---
    let socket = null;
    const sidebar = document.getElementById('sidebar');
    const portSelect = document.getElementById('port_select');
    const baudrateSelect = document.getElementById('baudrate_select');
    const baudrateCustom = document.getElementById('baudrate_custom');
    const bytesizeSelect = document.getElementById('bytesize_select');
    const paritySelect = document.getElementById('parity_select');
    const stopbitsSelect = document.getElementById('stopbits_select');
    const refreshButton = document.getElementById('refresh_ports_button');
    const connectButton = document.getElementById('connect_button');
    const statusText = document.getElementById('status_text');
    const logDiv = document.getElementById('log');
    const clearLogButton = document.getElementById('clear_log_button');
    const saveLogButton = document.getElementById('save_log_button');
    const sendInput = document.getElementById('send_input');
    const lineEndingSelect = document.getElementById('line_ending_select');
    const sendButton = document.getElementById('send_button');
    const hexDisplayToggle = document.getElementById('hex_display_toggle');
    const hexSendToggle = document.getElementById('hex_send_toggle');
    const rxLed = document.getElementById('rx_led');
    const txLed = document.getElementById('tx_led');
    const timestampToggle = document.getElementById('timestamp_toggle');
    const intervalInput = document.getElementById('interval_input');
    const timedSendToggle = document.getElementById('timed_send_toggle');
    const sidebarToggle = document.getElementById('sidebar_toggle');
    const scrollbackLimitInput = document.getElementById('scrollback_limit_input');
    const fontDecreaseButton = document.getElementById('font_decrease_button');
    const fontIncreaseButton = document.getElementById('font_increase_button');
    const fontSizeDisplay = document.getElementById('font_size_display');
    const pauseLogButton = document.getElementById('pause_log_button');
    const timedSendContainer = document.getElementById('timed_send_container');
    const timedSendOptionsToggle = document.getElementById('timed_send_options_toggle');
    let timedSendTimerId = null;
    let isClosingManually = false;
    let activeBaudrate = '';
    let isLogPaused = false;

    // --- Pause/resume log rendering ---
    pauseLogButton.addEventListener('click', () => {
        isLogPaused = !isLogPaused;
        pauseLogButton.textContent = isLogPaused ? 'Resume' : 'Pause';
        pauseLogButton.classList.toggle('paused', isLogPaused);
    });

    // --- Timed send: collapse/expand the interval field ---
    timedSendOptionsToggle.addEventListener('click', () => {
        timedSendContainer.classList.toggle('collapsed');
    });

    // Maximum number of log lines to keep in the display, configurable via the scrollback limit setting
    let maxLogLines = parseInt(scrollbackLimitInput.value, 10) || 5000;

    // --- Sidebar collapse/expand ---
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // --- Scrollback limit ---
    scrollbackLimitInput.addEventListener('change', function() {
        let value = parseInt(this.value, 10);
        if (isNaN(value) || value < 100) value = 100;
        this.value = value;
        maxLogLines = value;
        trimLogToLimit();
    });

    // --- Log font size ---
    const MIN_LOG_FONT_SIZE = 10;
    const MAX_LOG_FONT_SIZE = 24;
    let logFontSize = parseInt(getComputedStyle(logDiv).fontSize, 10) || 14;

    function applyLogFontSize() {
        logDiv.style.fontSize = logFontSize + 'px';
        fontSizeDisplay.textContent = logFontSize + 'px';
        fontDecreaseButton.disabled = logFontSize <= MIN_LOG_FONT_SIZE;
        fontIncreaseButton.disabled = logFontSize >= MAX_LOG_FONT_SIZE;
    }

    fontDecreaseButton.addEventListener('click', () => {
        logFontSize = Math.max(MIN_LOG_FONT_SIZE, logFontSize - 1);
        applyLogFontSize();
    });
    fontIncreaseButton.addEventListener('click', () => {
        logFontSize = Math.min(MAX_LOG_FONT_SIZE, logFontSize + 1);
        applyLogFontSize();
    });
    applyLogFontSize();

    // --- Baud Rate: show/hide custom input ---
    baudrateSelect.addEventListener('change', function() {
        baudrateCustom.style.display = this.value === 'custom' ? 'block' : 'none';
        if (this.value === 'custom') baudrateCustom.focus();
    });

    function getSelectedBaudrate() {
        if (baudrateSelect.value === 'custom') {
            const v = parseInt(baudrateCustom.value, 10);
            if (!v || v < 1) { alert('Please enter a valid baud rate.'); return null; }
            return v;
        }
        return baudrateSelect.value;
    }

    // --- UI Update Function ---
    function updateUIForConnection(isConnected) {
        const elementsToDisable = [portSelect, baudrateSelect, baudrateCustom, bytesizeSelect, paritySelect, stopbitsSelect, refreshButton];
        if (isConnected) {
            connectButton.textContent = 'Close Port';
            connectButton.className = 'connected';
            elementsToDisable.forEach(el => el.disabled = true);
            sendInput.disabled = false;
            sendButton.disabled = false;
            lineEndingSelect.disabled = false;
            hexSendToggle.disabled = false;
            saveLogButton.disabled = false;
            statusText.textContent = `Connected to ${portSelect.value} @ ${activeBaudrate} bps`;
        } else {
            connectButton.textContent = 'Open Port';
            connectButton.className = 'disconnected';
            elementsToDisable.forEach(el => el.disabled = false);
            sendInput.disabled = true;
            sendButton.disabled = true;
            lineEndingSelect.disabled = true;
            hexSendToggle.disabled = true;
            saveLogButton.disabled = true;
            statusText.textContent = 'Disconnected';
            if(socket) socket.disconnect();
            socket = null;
        }
    }

    // --- Socket.IO Event Handlers ---
    function setupSocketEventHandlers(_socket) {
        _socket.on('connect', () => updateUIForConnection(true));
        _socket.on('disconnect', () => {
            if (isClosingManually) {
                logToScreen(`// Port closed.`, 'info');
                isClosingManually = false;
            } else {
                logToScreen('// Connection lost (disconnected from server).', 'info');
            }
            if (timedSendToggle.checked) {
                timedSendToggle.checked = false;
                timedSendToggle.dispatchEvent(new Event('change'));
            }
            updateUIForConnection(false);
        });
        _socket.on('serial_data_recv', (msg) => {
            if (!hexDisplayToggle.checked) {
                flashLed(rxLed);
                if (!isLogPaused) logToScreen(msg.data, 'rx');
            }
        });
        _socket.on('serial_data_recv_hex', (msg) => {
            if (hexDisplayToggle.checked) {
                flashLed(rxLed);
                if (!isLogPaused) logToScreen(msg.data, 'hex');
            }
        });
        _socket.on('serial_error', (msg) => {
            logToScreen(`Error: ${msg.message}`, 'info');
            if (msg.fatal && _socket.connected) {
                updateUIForConnection(false);
            }
        });
        _socket.on('connect_error', (err) => {
            logToScreen(`Connection Error: ${err.message}`, 'info');
            updateUIForConnection(false);
        });
    }

    // --- Main Action Event Listeners ---
    connectButton.addEventListener('click', () => {
        if (connectButton.classList.contains('connected')) {
            isClosingManually = true;
            updateUIForConnection(false);
        } else {
            const port = portSelect.value;
            if (!port) { alert('Please select a serial port first!'); return; }
            const baudrate = getSelectedBaudrate();
            if (!baudrate) return;
            activeBaudrate = baudrate;
            const bytesize = bytesizeSelect.value;
            const parity = paritySelect.value;
            const stopbits = stopbitsSelect.value;
            statusText.textContent = `Connecting to ${port}...`;
            socket = io('/serial', { query: { port, baudrate, bytesize, parity, stopbits } });
            setupSocketEventHandlers(socket);
        }
    });

    refreshButton.addEventListener('click', async () => {
        const originalText = statusText.textContent;
        statusText.textContent = 'Refreshing port list...';
        try {
            const response = await fetch('/api/list_ports');
            const data = await response.json();
            if (data.success) {
                const currentPort = portSelect.value;
                portSelect.innerHTML = '<option value="">-- Select Port --</option>';
                data.ports.forEach(p => {
                    const option = document.createElement('option');
                    option.value = p; 
                    option.textContent = p;
                    if (p === currentPort) {
                        option.selected = true;
                    }
                    portSelect.appendChild(option);
                });
                statusText.textContent = 'Port list has been refreshed.';
            } else { statusText.textContent = `Refresh failed: ${data.message}`; }
        } catch (error) {
            statusText.textContent = `A network error occurred while refreshing.`;
            console.error('Failed to refresh ports:', error);
        }
        setTimeout(() => { 
            if (statusText.textContent.includes('Refresh')) {
                statusText.textContent = originalText;
            }
        }, 2000);
    });

    // --- Helper Functions ---
    function logToScreen(message, type) {
        const isScrolledToBottom = logDiv.scrollHeight - logDiv.clientHeight <= logDiv.scrollTop + 5;
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        
        if (timestampToggle.checked && type !== 'info') {
            const ts = document.createElement('span');
            ts.className = 'timestamp';
            ts.textContent = '[' + new Date().toLocaleTimeString('en-GB', { hour12: false }) + `.${String(new Date().getMilliseconds()).padStart(3,'0')}` + ']:';
            line.appendChild(ts);
        }
        line.appendChild(document.createTextNode(message));
        logDiv.appendChild(line);

        trimLogToLimit();

        if (isScrolledToBottom) logDiv.scrollTop = logDiv.scrollHeight;
    }

    function trimLogToLimit() {
        while (logDiv.childElementCount > maxLogLines) {
            logDiv.removeChild(logDiv.firstChild);
        }
    }

    clearLogButton.addEventListener('click', () => {
        logDiv.innerHTML = '';
        logToScreen(`// Log cleared at ${new Date().toLocaleTimeString()}`, 'info');
    });

    saveLogButton.addEventListener('click', () => {
        // 1. Get the plain text content from the log display area.
        const logText = logDiv.innerText;

        if (!logText.trim()) {
            alert('Log is empty, nothing to save.');
            return;
        }

        // 2. Create a Blob object, which represents the file's content.
        const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });

        // 3. Create a temporary invisible link element.
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        
        // 4. Set the filename for the download.
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        link.download = `serial-log-${portSelect.value}-${timestamp}.log`;

        // 5. Programmatically click the link to trigger the browser's download dialog.
        document.body.appendChild(link);
        link.click();

        // 6. Clean up by removing the temporary link and revoking the object URL.
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    });

    function sendData() {
        const data = sendInput.value;
        if (!data || !connectButton.classList.contains('connected')) return false;

        if (hexSendToggle.checked) {
            const hexClean = data.replace(/[\s:]/g, '');
            if (!/^[0-9a-fA-F]+$/.test(hexClean) || hexClean.length % 2 !== 0) {
                alert('Invalid HEX input. Please enter pairs of hex digits separated by spaces (e.g. FF 01 AB CD).');
                return false;
            }
            socket.emit('serial_data_send', { data: hexClean, is_hex: true });
            logToScreen(hexClean.toUpperCase().match(/.{2}/g).join(' '), 'tx');
        } else {
            const endingMap = { none: '', lf: '\n', cr: '\r', crlf: '\r\n' };
            const end_with = endingMap[lineEndingSelect.value];
            socket.emit('serial_data_send', { data, end_with });
            if (hexDisplayToggle.checked) {
                // Show TX bytes as HEX when HEX display mode is active
                const hexStr = Array.from(new TextEncoder().encode(data + end_with))
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
                logToScreen(hexStr, 'tx');
            } else {
                logToScreen(data, 'tx');
            }
        }
        flashLed(txLed);
        return true;
    }

    // Manual sends (button click / Enter) clear the input afterwards; timed
    // send re-invokes sendData() directly off the timer so it keeps reusing
    // the same input value on each tick.
    sendButton.addEventListener('click', () => {
        if (sendData()) sendInput.value = '';
    });
    sendInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (sendData()) sendInput.value = '';
        }
    });

    function flashLed(ledElement) {
        ledElement.classList.add('on');
        setTimeout(() => ledElement.classList.remove('on'), 150);
    }

    hexDisplayToggle.addEventListener('change', function() {
        logToScreen(`// Display mode switched to: ${this.checked ? 'HEX' : 'Text'}`, 'info');
    });

    timestampToggle.addEventListener('change', function() {
        logToScreen(`// Timestamps ${this.checked ? 'enabled' : 'disabled'}`, 'info');
    });

    hexSendToggle.addEventListener('change', function() {
        sendInput.placeholder = this.checked ? 'e.g. FF 01 AB CD ...' : 'Enter data to send...';
        sendInput.value = '';
    });

    // --- Timed Send Logic ---
    timedSendToggle.addEventListener('change', function() {
        if (this.checked) {
            const data = sendInput.value;
            const interval = parseInt(intervalInput.value, 10);
            if (!data) {
                alert('Send content cannot be empty!');
                this.checked = false; return;
            }
            if (isNaN(interval) || interval < 100) {
                alert('Interval must be a number greater than or equal to 100!');
                this.checked = false; return;
            }
            timedSendTimerId = setInterval(() => { sendData(data); }, interval);
            sendInput.disabled = true;
            sendButton.disabled = true;
            lineEndingSelect.disabled = true;
            hexSendToggle.disabled = true;
            intervalInput.disabled = true;
            statusText.textContent = `Sending data every ${interval}ms...`;
        } else {
            if (timedSendTimerId) {
                clearInterval(timedSendTimerId);
                timedSendTimerId = null;
            }
            if (connectButton.classList.contains('connected')) {
                sendInput.disabled = false;
                sendButton.disabled = false;
                lineEndingSelect.disabled = false;
                hexSendToggle.disabled = false;
            }
            intervalInput.disabled = false;
            if (socket && socket.connected) {
                statusText.textContent = `Connected to ${portSelect.value} @ ${activeBaudrate} bps`;
            } else {
                statusText.textContent = 'Disconnected';
            }
        }
    });
});
