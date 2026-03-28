// ==========================================
// 系統變數初始化
// ==========================================
let musicData = [];
let rhythmDatabase = {};
let presetDatabase = {};
let gridDatabase = {};

const bgVideo = document.getElementById('bg-video');
const playlistContainer = document.getElementById('playlist-container');
const rhythmListContainer = document.getElementById('rhythm-list-container');

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let clapBuffer = null;
let capitalBuffer = null;
let bgmBuffer = null;
let bgmSource = null;

let isPlaying = false;      
let currentBPM = 120; 

let activePresetSequence = {}; 
let queuedPattern = null; 
let currentPattern = 'V'; 
let halfwayTriggered = false;

let queuedBox = null;                 
let manualOverrideBoxId = null; 

// --- 高精度狀態與指令時間追蹤器 ---
window.lastAutoBoxId = null;    
window.lastRenderedBox = null;
window.lastRenderedActionTime = -1;
window.lastManualOverrideTime = -1;
let lastAbsoluteBeat = -1;      

let ctxPlayStartTime = 0;
let loopStartRealTime = 0;

let audioLoopsProcessed = 0;
let audioBeatIndex = 0;
let audioPresetClock = 0;
let audioPattern = 'V';

let visualLoopsProcessed = 0;
let visualBeatIndex = 0;
let presetClock = 0;

let playAnimationId = null;
bgVideo.playbackRate = currentBPM / 122;
let armedSongInfo = null; 

const playheadCurrent = document.getElementById('playhead-current');
const notesCurrentContainer = document.getElementById('notes-current');
const notesQueuedContainer = document.getElementById('notes-queued');
const trackCurrentLabel = document.getElementById('track-current-label');
const trackQueuedLabel = document.getElementById('track-queued-label');
const trackQueued = document.getElementById('track-queued');

// ==========================================
// 初始化與載入
// ==========================================
async function initializeApp() {
    try {
        rhythmDatabase = await (await fetch('rhythms.json')).json();
        musicData = await (await fetch('songs.json')).json();

        try {
            const presetRawData = await (await fetch('presets.json')).json();
            presetRawData.forEach(p => {
                const seqDict = {};
                p.sequence.forEach(s => seqDict[s.time] = s.action);
                presetDatabase[p.musicId] = seqDict;
            });
        } catch (e) { console.warn("找不到 presets.json"); }

        try {
            const gridRawData = await (await fetch('grid.json')).json();
            gridRawData.forEach(p => gridDatabase[p.musicId] = p.sequence);
        } catch (e) { console.warn("找不到 grid.json"); }

        musicData.forEach(song => {
            if (!song.rhythms) song.rhythms = {};
            song.rhythms['Z'] = 'R16'; 
            if (!song.rhythms['V']) song.rhythms['V'] = 'R01';
            if (!gridDatabase[song.id]) gridDatabase[song.id] = [];
        });

        initPlaylist();
        rhythmListContainer.innerHTML = '<div style="color: #888; text-align: center; margin-top: 20px;">請先選擇右側歌曲</div>';
        window.isAppInitialized = true;
    } catch (error) {
        alert("資料載入失敗！請確認 JSON 檔案是否存在。");
    }
}

async function loadSound(url) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) { return null; }
}

loadSound('Clap.wav').then(buffer => clapBuffer = buffer);
loadSound('Capital.wav').then(buffer => capitalBuffer = buffer);

function playHitSound(isAccent, preciseTime) {
    const buffer = isAccent ? capitalBuffer : clapBuffer;
    if (!buffer) return; 
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.5; 
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start(preciseTime);
}

// ==========================================
// 視覺輔助與 UI
// ==========================================
function renderSequencerTrack(container, patternKey, noteClass) {
    if (!armedSongInfo) return;
    container.innerHTML = ''; 
    const rhythmId = armedSongInfo.rhythms[patternKey];
    if (!rhythmId || !rhythmDatabase[rhythmId]) return;
    
    rhythmDatabase[rhythmId].beats.forEach(beat => {
        const block = document.createElement('div');
        block.className = `note-block ${noteClass}`;
        block.style.left = `${(beat / 8) * 100}%`;
        container.appendChild(block);
    });
}

function renderRhythmList(rhythmMap) {
    rhythmListContainer.innerHTML = '';
    const sortedKeys = ['I', 'V', 'X', 'C', 'D', 'F', 'R', 'B', 'G', 'T', 'E', 'Z'].filter(k => rhythmMap[k]);

    sortedKeys.forEach(keyStr => {
        const rhythmId = rhythmMap[keyStr];
        const data = rhythmDatabase[rhythmId];
        let blocksHTML = '';
        data.beats.forEach(beat => blocksHTML += `<div class="mini-note-block" style="left: ${(beat / 8) * 100}%"></div>`);

        const itemDiv = document.createElement('div');
        itemDiv.className = 'rhythm-item';
        itemDiv.innerHTML = `
            <div class="rhythm-key" id="rhythm-key-${keyStr}">${keyStr}</div>
            <div class="mini-track">${blocksHTML}</div>
        `;
        rhythmListContainer.appendChild(itemDiv);
    });
}

function initPlaylist() {
    musicData.forEach((song, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'playlist-item';
        itemDiv.id = `playlist-item-${song.id}`;
        itemDiv.innerHTML = `
            <button class="play-btn" onclick="armSong(${index})"></button>
            <div class="song-info">
                <span class="song-title">${song.id}. ${song.title}</span>
                <span class="song-bpm">BPM: ${song.bpm}</span>
            </div>
        `;
        playlistContainer.appendChild(itemDiv);
    });
}

function updateRhythmUI() {
    if (!armedSongInfo) return;

    document.querySelectorAll('.rhythm-key').forEach(el => {
        el.style.backgroundColor = '#333';
        el.style.color = 'white';
        el.style.boxShadow = 'inset 0 0 5px rgba(0,0,0,0.5)';
    });

    if (isPlaying) {
        const currentEl = document.getElementById(`rhythm-key-${currentPattern}`);
        if (currentEl) {
            currentEl.style.backgroundColor = '#FFD700'; 
            currentEl.style.color = '#000';
            currentEl.style.boxShadow = '0 0 15px rgba(255,215,0,0.6)';
        }
        trackCurrentLabel.textContent = `[ ${currentPattern} ]`;
        renderSequencerTrack(notesCurrentContainer, currentPattern, 'note-current');
    } else {
        trackCurrentLabel.textContent = ``; 
        notesCurrentContainer.innerHTML = '';
    }

    if (queuedPattern) {
        const queuedEl = document.getElementById(`rhythm-key-${queuedPattern}`);
        if (queuedEl) {
            queuedEl.style.backgroundColor = '#00FFFF'; 
            queuedEl.style.color = '#000';
            queuedEl.style.boxShadow = '0 0 15px rgba(0,255,255,0.6)';
        }
        trackQueuedLabel.textContent = `[ ${queuedPattern} ]`;
        trackQueued.classList.remove('disabled');
        renderSequencerTrack(notesQueuedContainer, queuedPattern, 'note-queued');
    } else {
        trackQueuedLabel.textContent = ``; 
        trackQueued.classList.add('disabled');
        notesQueuedContainer.innerHTML = '';
    }
}

function getGridBoxAtTime(decimalTime) {
    if (!armedSongInfo) return null;
    const seq = gridDatabase[armedSongInfo.id] || [];
    let activeBox = null;
    for (let i = 0; i < seq.length; i++) {
        if (seq[i].time <= decimalTime + 0.0001) activeBox = seq[i].box;
        else break;
    }
    return activeBox;
}

// ==========================================
// 歌曲載入與重置
// ==========================================
window.armSong = async function(index) {
    const song = musicData[index];
    
    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('armed'));
    const itemEl = document.getElementById(`playlist-item-${song.id}`);
    itemEl.classList.add('armed');
    
    const originalText = itemEl.querySelector('.song-title').textContent;
    itemEl.querySelector('.song-title').textContent = "⏳ 載入解碼中...";

    resetApp(); 
    armedSongInfo = song;
    activePresetSequence = presetDatabase[song.id] || {};

    try {
        const response = await fetch(song.file);
        const arrayBuffer = await response.arrayBuffer();
        bgmBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        currentBPM = song.bpm;
        const secondsPerBeat = 60 / currentBPM;
        const loopDuration = secondsPerBeat * 8;
        document.documentElement.style.setProperty('--loop-duration', `${loopDuration}s`);
        bgVideo.playbackRate = currentBPM / 122;

        renderRhythmList(song.rhythms);
        updateRhythmUI();
        itemEl.querySelector('.song-title').textContent = originalText;
    } catch (e) {
        console.error("歌曲解碼失敗：", e);
        itemEl.querySelector('.song-title').textContent = originalText + " (載入失敗)";
    }
}

function resetApp() {
    isPlaying = false;       
    
    if (bgmSource) {
        bgmSource.stop();
        bgmSource.disconnect();
        bgmSource = null;
    }

    presetClock = 0;
    halfwayTriggered = false;
    
    if (activePresetSequence && activePresetSequence[0]) currentPattern = activePresetSequence[0];
    else if (armedSongInfo && armedSongInfo.rhythms['I']) currentPattern = 'I';
    else currentPattern = 'V'; 
    
    queuedPattern = null;
    queuedBox = null;
    manualOverrideBoxId = null;
    
    window.lastAutoBoxId = null;
    window.lastRenderedBox = null;
    window.lastRenderedActionTime = -1;
    window.lastManualOverrideTime = -1;
    lastAbsoluteBeat = -1;
    
    updateRhythmUI(); 
    playheadCurrent.style.display = 'none'; 
    playheadCurrent.style.left = '0%';

    for (let id = 1; id <= 9; id++) {
        const boxEl = document.getElementById(`box-${id}`);
        if(boxEl) boxEl.classList.remove('active', 'beat-hit', 'preparing');
        const approachEl = document.getElementById(`approach-${id}`);
        if(approachEl) approachEl.innerHTML = '';
    }

    if (playAnimationId) cancelAnimationFrame(playAnimationId);
}

// ==========================================
// 終極全 JS 全自動排程、算圖與點火引擎
// ==========================================
function playLoop() {
    if (!isPlaying || !armedSongInfo) return;

    const currentRealTime = audioCtx.currentTime;
    
    if (bgmBuffer && (currentRealTime - ctxPlayStartTime) * (currentBPM / armedSongInfo.bpm) >= bgmBuffer.duration) {
        resetApp();
        return;
    }

    const lookaheadRealTime = currentRealTime + 0.1; 
    const loopDurationRealTime = (60 / currentBPM) * 8;
    const secondsPerBeatRealTime = 60 / currentBPM;

    // --- 1. Audio Scheduler (提前 0.1 秒預約音效卡：只跟隨基本節奏) ---
    while (true) {
        let loopBaseRealTime = loopStartRealTime + (audioLoopsProcessed * loopDurationRealTime);
        if (loopBaseRealTime > lookaheadRealTime) break;

        let currentRhythmId = armedSongInfo.rhythms[audioPattern];
        let beats = rhythmDatabase[currentRhythmId] ? rhythmDatabase[currentRhythmId].beats : [];
        
        if (audioBeatIndex >= beats.length) {
            audioLoopsProcessed++;
            audioBeatIndex = 0;
            audioPresetClock++;
            audioPattern = queuedPattern || activePresetSequence[audioPresetClock] || audioPattern;
            continue;
        }

        let beatPos = beats[audioBeatIndex];
        let beatRealTime = loopBaseRealTime + (beatPos / 8) * loopDurationRealTime;

        if (beatRealTime < lookaheadRealTime) {
            if (beatRealTime >= currentRealTime - 0.05) { 
                playHitSound(audioBeatIndex === 0, beatRealTime);
            }
            audioBeatIndex++;
        } else {
            break;
        }
    }

    // --- 2. Visual Scheduler & 掃描線 ---
    let visualLoopBaseRealTime = loopStartRealTime + (visualLoopsProcessed * loopDurationRealTime);
    let elapsedInVisualLoop = currentRealTime - visualLoopBaseRealTime;

    while (elapsedInVisualLoop >= loopDurationRealTime) {
        visualLoopsProcessed++;
        visualBeatIndex = 0;
        presetClock++;
        halfwayTriggered = false;
        
        let nextPattern = queuedPattern || activePresetSequence[presetClock] || currentPattern;
        if (queuedPattern) queuedPattern = null; 
        currentPattern = nextPattern;
        updateRhythmUI();
        
        visualLoopBaseRealTime = loopStartRealTime + (visualLoopsProcessed * loopDurationRealTime);
        elapsedInVisualLoop = currentRealTime - visualLoopBaseRealTime;
    }

    playheadCurrent.style.display = 'block';
    playheadCurrent.style.left = `${(elapsedInVisualLoop / loopDurationRealTime) * 100}%`;

    // --- 3. 九宮格自動化 Osu! 縮圈數學算圖 ---
    let currentDecimalTime = visualLoopsProcessed + (elapsedInVisualLoop / loopDurationRealTime);
    
    let approaches = { 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '', 8: '', 9: '' };
    const seq = gridDatabase[armedSongInfo.id] || [];
    
    let autoBox = null;
    let activeActionTime = -1;

    for (let i = 0; i < seq.length; i++) {
        const actionTime = seq[i].time;
        const targetBox = seq[i].box;

        if (actionTime <= currentDecimalTime + 0.0001) {
            autoBox = targetBox;
            activeActionTime = actionTime;
        }

        if (targetBox !== 'CLEAR') {
            const startTime = actionTime - 0.25; 
            if (currentDecimalTime >= startTime && currentDecimalTime < actionTime) {
                const P = (currentDecimalTime - startTime) / 0.25; 
                const scale = 2.2 - (1.2 * P);
                let opacity = 0;
                if (P < 0.3) opacity = (P / 0.3) * 0.2; 
                else opacity = 0.2 + ((P - 0.3) / 0.7) * 0.8; 
                approaches[targetBox] += `<div class="approach-circle" style="transform: scale(${scale}); opacity: ${opacity};"></div>`;
            }
        }
    }

    for (let id = 1; id <= 9; id++) {
        const container = document.getElementById(`approach-${id}`);
        if (container && container.innerHTML !== approaches[id]) {
            container.innerHTML = approaches[id];
        }
    }

    // --- 4. 自動化控制與指令震動點火 (僅跟隨切換指令) ---
    if (autoBox !== window.lastAutoBoxId) {
        manualOverrideBoxId = null;
        window.lastAutoBoxId = autoBox;
    }

    let currentBeatInLoop = elapsedInVisualLoop / secondsPerBeatRealTime;
    const absoluteBeat = Math.floor((visualLoopsProcessed * 8) + currentBeatInLoop);
    
    if (absoluteBeat > lastAbsoluteBeat) {
        lastAbsoluteBeat = absoluteBeat;
        if (queuedBox) {
            manualOverrideBoxId = queuedBox;
            window.lastManualOverrideTime = visualLoopsProcessed + ((absoluteBeat % 8) / 8); 
            queuedBox = null; 
        }
    }

    let finalActiveBox = manualOverrideBoxId || autoBox;
    let finalActionTime = manualOverrideBoxId ? window.lastManualOverrideTime : activeActionTime;

    if (finalActionTime !== window.lastRenderedActionTime || finalActiveBox !== window.lastRenderedBox) {
        [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(id => {
            const boxEl = document.getElementById(`box-${id}`);
            if (!boxEl) return;

            if (id == finalActiveBox) {
                if (!boxEl.classList.contains('active')) {
                    boxEl.classList.add('active');
                }
                
                // 只要收到新的指令時間，就讓方塊震動！
                if (isPlaying && finalActionTime !== window.lastRenderedActionTime) {
                    boxEl.classList.remove('beat-hit');
                    void boxEl.offsetWidth;
                    boxEl.classList.add('beat-hit');
                }
            } else {
                boxEl.classList.remove('active', 'beat-hit');
            }
        });

        window.lastRenderedBox = finalActiveBox;
        window.lastRenderedActionTime = finalActionTime;
    }

    // --- 5. 時序圖序列器光點 (僅跟隨基礎節奏) ---
    let currentRhythmId = armedSongInfo.rhythms[currentPattern];
    let beats = rhythmDatabase[currentRhythmId] ? rhythmDatabase[currentRhythmId].beats : [];

    for (let i = visualBeatIndex; i < beats.length; i++) {
        if (currentBeatInLoop >= beats[i]) {
            // 只有序列器光點會跟著背景節奏閃爍
            const noteEl = notesCurrentContainer.children[i];
            if (noteEl) {
                noteEl.classList.remove('hit');
                void noteEl.offsetWidth; 
                noteEl.classList.add('hit');
            }
            visualBeatIndex = i + 1;
        } else {
            break;
        }
    }

    if (currentBeatInLoop >= 4 && !halfwayTriggered) {
        halfwayTriggered = true;
        if (activePresetSequence[presetClock + 1]) {
            queuedPattern = activePresetSequence[presetClock + 1];
            updateRhythmUI();
        }
    }

    playAnimationId = requestAnimationFrame(playLoop);
}

// ==========================================
// 播放控制 (全局空白鍵切換)
// ==========================================
window.togglePlay = function() {
    if(!armedSongInfo || !bgmBuffer) return alert("請先從右側清單選擇並等待樂曲解碼完成！");
    
    if(audioCtx.state === 'suspended') audioCtx.resume();

    if(isPlaying) {
        resetApp(); 
    } else {
        isPlaying = true;
        bgmSource = audioCtx.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.playbackRate.value = currentBPM / armedSongInfo.bpm;
        bgmSource.connect(audioCtx.destination);
        
        let nowReal = audioCtx.currentTime;
        ctxPlayStartTime = nowReal;
        loopStartRealTime = nowReal;
        
        audioLoopsProcessed = 0;
        audioBeatIndex = 0;
        audioPresetClock = 0;
        presetClock = 0;
        halfwayTriggered = false;
        
        if (activePresetSequence[0]) currentPattern = activePresetSequence[0];
        else if (armedSongInfo.rhythms['I']) currentPattern = 'I';
        else currentPattern = 'V'; 
        
        audioPattern = currentPattern;
        visualLoopsProcessed = 0;
        visualBeatIndex = 0;
        
        window.lastRenderedBox = null;
        window.lastRenderedActionTime = -1;
        
        updateRhythmUI(); 
        bgmSource.start(nowReal); 
        playAnimationId = requestAnimationFrame(playLoop);
    }
}

document.addEventListener('keydown', function(event) {
    if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault(); 
        togglePlay();
        return; 
    }

    const keyStr = event.key.toUpperCase(); 
    if (armedSongInfo && armedSongInfo.rhythms[keyStr]) {
        if (!isPlaying) return;
        if (keyStr === currentPattern) queuedPattern = null;
        else queuedPattern = keyStr;
        updateRhythmUI(); 
    }
});

initializeApp();