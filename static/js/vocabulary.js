let vocabulary = new Map();
// default to 'not reviewed' tab
let currentFilter = 'unreviewed';
let classes = [];
let currentClass = null;

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const statsBar = document.getElementById('statsBar');
const filters = document.getElementById('filters');
const wordsSection = document.getElementById('wordsSection');
const wordsGrid = document.getElementById('wordsGrid');
const searchBox = document.getElementById('searchBox');
const filterButtons = document.querySelectorAll('.filter-btn');
const classSection = document.getElementById('classSection');
const classGrid = document.getElementById('classGrid');
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const contextList = document.getElementById('contextList');

// Title-picker modal elements
const titleModalOverlay = document.getElementById('titleModalOverlay');
const titleInput = document.getElementById('titleInput');
const titleCancelBtn = document.getElementById('titleCancelBtn');
const titleSaveBtn = document.getElementById('titleSaveBtn');
const titleModalHeading = document.getElementById('titleModalHeading');

// Load from server on start (do not rely on localStorage)
(async function initData() {
    try {
        await loadFromServer();
    } catch (err) {
        console.warn('Server load failed; page will start empty', err);
        // leave UI empty — user can import via the Import button
        mergeVocabulary();
        displayClasses();
        displayWords();
        updateStats();
    }
})();

// Modal controls (context modal)
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
});

let currentContextWord = null; // word currently shown in context modal
function closeModal() {
    modalOverlay.classList.remove('active');
}

// format seconds -> mm:ss (used for context timestamps)
function formatTime(seconds) {
    if (seconds == null) return '';
    const s = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

// detect YouTube URLs and build time-linked URLs
function parseYouTubeUrl(s) {
    if (!s || typeof s !== 'string') return null;
    try {
        const u = new URL(s.includes('://') ? s : 'https://' + s);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        if (host === 'youtu.be') {
            const id = u.pathname.replace(/^\//, '');
            if (id) return { id, original: s, canonical: `https://youtu.be/${id}` };
        }
        if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host.endsWith('.youtube.com')) {
            const v = u.searchParams.get('v');
            if (v) return { id: v, original: s, canonical: `https://www.youtube.com/watch?v=${v}` };
        }
    } catch (e) {
        return null;
    }
    return null;
}

function youTubeUrlAt(id, seconds) {
    if (!id) return null;
    const t = (seconds != null) ? `?t=${Math.max(0, Math.floor(seconds))}` : '';
    return `https://youtu.be/${encodeURIComponent(id)}${t}`;
}

function formatClassLabel(name) {
    const info = parseYouTubeUrl(name);
    if (info) return `YouTube — ${escapeHtml(info.id)}`;

    // show host/path for URL-like titles so dropdown isn't full URL
    try {
        const u = new URL(name.includes('://') ? name : 'https://' + name);
        return `${escapeHtml(u.hostname)}${u.pathname && u.pathname !== '/' ? escapeHtml(u.pathname.slice(0, 24) + (u.pathname.length > 24 ? '…' : '')) : ''}`;
    } catch (e) {
        return escapeHtml(name);
    }
}

function classTitleHtml(name, startSeconds) {
    const info = parseYouTubeUrl(name);
    if (info) {
        const url = youTubeUrlAt(info.id, startSeconds);
        const label = `YouTube — ${escapeHtml(info.id)}`;
        return `<a class="class-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}${startSeconds != null ? ' • ' + escapeHtml(formatTime(startSeconds)) : ''}</a>`;
    }
    return `${escapeHtml(name)}${startSeconds != null ? ' • ' + escapeHtml(formatTime(startSeconds)) : ''}`;
}

// Render a class/title value — if it's a YouTube URL make a time-linked anchor;
// if it's any URL, render an anchor with truncated host/path; otherwise escape text.
function maybeLinkifyTitle(name, startSeconds) {
    if (!name) return '';
    const yt = parseYouTubeUrl(name);
    if (yt) return classTitleHtml(name, startSeconds);

    // try generic URL
    try {
        const u = new URL(name.includes('://') ? name : 'https://' + name);
        const href = u.href;
        const label = `${u.hostname}${u.pathname && u.pathname !== '/' ? u.pathname : ''}`;
        const short = label.length > 36 ? label.slice(0, 33) + '…' : label;
        return `<a class="class-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(short)}${startSeconds != null ? ' • ' + escapeHtml(formatTime(startSeconds)) : ''}</a>`;
    } catch (e) {
        return `${escapeHtml(name)}${startSeconds != null ? ' • ' + escapeHtml(formatTime(startSeconds)) : ''}`;
    }
}

function openContextModal(word, wordObj) {
    currentContextWord = word;
    modalTitle.textContent = `"${word}" in Context`;
    contextList.innerHTML = '';

    // Get all phrases containing this word from all classes
    const contexts = [];
    
    classes.forEach(cls => {
        if (cls.vocabulary.has(word) && cls.phrases) {
            cls.phrases.forEach(phrase => {
                const pText = (typeof phrase === 'string') ? phrase : (phrase.text || '');
                const pStart = (typeof phrase === 'string') ? null : (phrase.start ?? null);
                if (pText.toLowerCase().includes(word.toLowerCase())) {
                    contexts.push({
                        text: pText,
                        className: cls.name,
                        start: pStart
                    });
                }
            });
        }
    });

    if (contexts.length === 0) {
        contextList.innerHTML = `
            <div class="no-context">
                <p>No context available for this word</p>
            </div>
        `;
    } else {
        contexts.forEach(context => {
            const contextItem = document.createElement('div');
            contextItem.className = 'context-item';
            
            // Highlight the word in the phrase
            const regex = new RegExp(`\\b(${word})\\b`, 'gi');
            const highlightedText = context.text.replace(regex, '<span class="highlight">$1</span>');
            
            // render class/title — if it's a YouTube URL, make the title + timestamp a link to the video at that time
            const metaHtml = `From: ${maybeLinkifyTitle(context.className, context.start ?? null)}`;

            contextItem.innerHTML = `
                <div>${highlightedText}</div>
                <div class="context-meta">${metaHtml}</div>
            `;
            
            contextList.appendChild(contextItem);
        });
    }

    modalOverlay.classList.add('active');
}

// ----- Translation button / modal logic -----
const translateBtnEl = document.getElementById('translateBtn');
// create translation modal elements references
const translateOverlay = document.createElement('div');
// (we'll reference the existing overlay DOM we added later by id)
const translateCloseBtn = document.getElementById('translateClose') || null;

// ----- Title-picker modal logic -----
titleCancelBtn.addEventListener('click', () => {
    titleModalOverlay.style.display = 'none';
    titleInput.value = '';
    try { titleResolve(null); } catch (e) {}
    // reset resolver to a no-op so stale references won't block future prompts
    titleResolve = (v) => {};
});
titleModalOverlay.addEventListener('click', (e) => {
    if (e.target === titleModalOverlay) {
        titleModalOverlay.style.display = 'none';
        titleInput.value = '';
        try { titleResolve(null); } catch (e) {}
        titleResolve = (v) => {};
    }
});
titleSaveBtn.addEventListener('click', () => {
    const v = (titleInput.value || '').trim();
    titleModalOverlay.style.display = 'none';
    titleInput.value = '';
    try { titleResolve(v || null); } catch (e) {}
    titleResolve = (v) => {};
});

// helper used by promptForClassTitle to resolve the user's choice
let titleResolve = (v) => {}; 

function promptForClassTitle(defaultTitle) {
    return new Promise((resolve) => {
        titleInput.value = defaultTitle || '';
        titleModalOverlay.style.display = 'flex';
        titleInput.select();
        titleResolve = resolve;
    });
}

// ----- Translation modal logic -----
const translateOverlayEl = document.getElementById('translateOverlay');
const translateClose = document.getElementById('translateClose');
const translateLoading = document.getElementById('translateLoading');
const translateContent = document.getElementById('translateContent');
const translateModalTitle = document.getElementById('translateModalTitle');

// close translation modal
translateClose.addEventListener('click', () => { translateOverlayEl.style.display = 'none'; translateContent.style.display = 'none'; translateLoading.style.display = 'block'; });
translateOverlayEl.addEventListener('click', (e) => { if (e.target === translateOverlayEl) translateOverlayEl.style.display = 'none'; });

// translate button on context modal
translateBtnEl.addEventListener('click', async () => {
    if (!currentContextWord) return alert('No word selected');
    await showTranslationFor(currentContextWord);
});

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function fetchDefinitions(word) {
    try {
        const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        return data; // array of entries
    } catch (err) {
        return null;
    }
}

async function translateToPortuguese(text) {
    // Using MyMemory API (no API key) for demo translations
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|pt`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const j = await resp.json();
        const translated = (j && j.responseData && j.responseData.translatedText) || (j && j.matches && j.matches[0] && j.matches[0].translation) || null;
        return translated;
    } catch (err) {
        return null;
    }
}

async function showTranslationFor(word) {
    translateModalTitle.textContent = `Translation & definitions for "${word}"`;
    translateOverlayEl.style.display = 'flex';
    translateLoading.textContent = 'Fetching translation & definitions...';
    translateLoading.style.display = 'block';
    translateContent.style.display = 'none';
    translateContent.innerHTML = '';

    const [defs, translation] = await Promise.all([fetchDefinitions(word), translateToPortuguese(word)]);

    // Build content
    const parts = [];
    if (translation) {
        parts.push(`<div style="margin-bottom:8px;"><strong>Portuguese:</strong> <span style='color:#34d399'>${escapeHtml(translation)}</span></div>`);
    } else {
        parts.push(`<div style="margin-bottom:8px;color:#999;"><em>No automated translation available.</em></div>`);
    }

    if (defs && Array.isArray(defs) && defs.length > 0) {
        const defHtml = defs.map(entry => {
            const wordHead = escapeHtml(entry.word || '');
            const phon = entry.phonetics && entry.phonetics.length ? escapeHtml(entry.phonetics.map(p=>p.text).filter(Boolean).join(', ')) : '';
            const meanings = (entry.meanings || []).map(m => {
                const senses = (m.definitions || []).map(d => {
                    const ex = d.example ? `<div style="color:#9aa4bf;margin-top:4px;">Example: ${escapeHtml(d.example)}</div>` : '';
                    return `<li><strong>${escapeHtml(d.definition)}</strong>${ex}</li>`;
                }).join('');
                return `<div style="margin-top:6px;"><em>${escapeHtml(m.partOfSpeech)}</em><ul style='margin:6px 0 0 18px;'>${senses}</ul></div>`;
            }).join('');
            return `<div style="margin-bottom:12px;"><div><strong>${wordHead}</strong> ${phon ? `<span style="color:#9aa4bf">${phon}</span>` : ''}</div>${meanings}</div>`;
        }).join('');
        parts.push(`<div><strong>Definitions:</strong>${defHtml}</div>`);
    } else {
        parts.push(`<div style="color:#999;"><em>No dictionary definitions found.</em></div>`);
    }

    translateContent.innerHTML = parts.join('');
    translateLoading.style.display = 'none';
    translateContent.style.display = 'block';
}

// Upload area interactions
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.srt') || file.name.endsWith('.txt'))) {
        handleFile(file);
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && (file.name.endsWith('.srt') || file.name.endsWith('.txt'))) handleFile(file);
});

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        // prevent concurrent uploads from interfering with UI/promises
        uploadArea.classList.add('disabled');
        try {
            const content = e.target.result;
            const fileName = file.name.replace(/\.(srt|txt)$/i, '');
            if (file.name.toLowerCase().endsWith('.txt')) {
                await parsePlainText(content, fileName);
            } else {
                await parseSubtitles(content, fileName);
            }
        } catch (err) {
            console.error('Failed parsing file', err);
            alert('Import failed: ' + (err && err.message ? err.message : err));
        } finally {
            // always clear input so same file can be re-selected and UI stays responsive
            try { fileInput.value = ''; } catch (ignore) {}
            uploadArea.classList.remove('disabled');
        }
    };
    reader.readAsText(file);
}

async function parseSubtitles(content, className) {
    // show title-picker with sensible default (Class - DD-MM-YYYY)
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const defaultTitle = `Class - ${dd}-${mm}-${yyyy}`;

    const chosen = await promptForClassTitle(className || defaultTitle);
    if (!chosen) return; // user cancelled

    const title = chosen;

    // Extract phrases (subtitle lines)
    const lines = content.split('\n');
    const phrases = [];
    let currentPhrase = '';
    
    let lastStart = null; // seconds (from most recent timestamp line)
    let currentPhraseStart = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Timestamp line (SRT) -> capture start time
        const tsMatch = line.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
        if (tsMatch) {
            const h = Number(tsMatch[1]), m = Number(tsMatch[2]), s = Number(tsMatch[3]), ms = Number(tsMatch[4]);
            lastStart = h * 3600 + m * 60 + s + Math.floor(ms / 1000);
            continue;
        }
        // Skip numeric index lines
        if (line && !line.match(/^\d+$/)) {
            // Remove HTML tags
            const cleanLine = line.replace(/<[^>]*>/g, '');
            if (cleanLine) {
                if (!currentPhrase) currentPhraseStart = lastStart; // associate the phrase with the most recent timestamp
                currentPhrase += (currentPhrase ? ' ' : '') + cleanLine;
            }
        } else if (currentPhrase) {
            // push as object with optional start time (backwards-compatible consumer can accept string or object)
            phrases.push({ text: currentPhrase, start: currentPhraseStart });
            currentPhrase = '';
            currentPhraseStart = null;
        }
    }
    if (currentPhrase) phrases.push({ text: currentPhrase, start: currentPhraseStart });

    // Remove subtitle numbers, timestamps, and formatting for word extraction
    const text = content
        .replace(/\d+\n/g, '')
        .replace(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/g, '')
        .replace(/<[^>]*>/g, '')
        .toLowerCase();

    // Extract words using a Unicode-aware regex (handles accents/diacritics)
    // and include apostrophes; this returns every matched token.
    const words = text.match(/\b[\p{L}']+\b/gu) || [];
    console.debug('parsed tokens total:', words.length);
    
    // Count word frequencies
    const wordFreq = new Map();
    words.forEach(word => {
        // include everything except empty strings; previously we ignored
        // <3-character words which filtered out "i", "he", "a", etc.
        if (word.length > 0) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
    });

    // Build class data to send to server
    const classPayload = {
        id: String(Date.now()),
        name: title,
        date: new Date().toISOString(),
        // phrases now include start times: array of { text, start }
        phrases: phrases,
        vocabulary: Array.from(wordFreq.entries()).map(([word, freq]) => ({
            word,
            frequency: freq,
            // Preserve any existing status in the global vocabulary map (known/unknown); default to 'unreviewed'
            status: (vocabulary.has(word) && vocabulary.get(word).status) ? vocabulary.get(word).status : 'unreviewed',
            excluded: (vocabulary.has(word) && vocabulary.get(word).excluded) ? true : false
        }))
    }; 

    // Persist to server and then reload from server (server is source of truth)
    try {
        await fetch('/api/vocab/class', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(classPayload)
        });
        await loadFromServer();
    } catch (err) {
        console.error('Failed to save class to server', err);
        // still show locally so user can continue
        const newClass = {
            id: Date.now(),
            name: title,
            date: new Date().toISOString(),
            vocabulary: new Map(),
            phrases: phrases,
            totalWords: wordFreq.size,
            knownCount: 0,
            unknownCount: 0
        };
        wordFreq.forEach((frequency, word) => {
            newClass.vocabulary.set(word, { word: word, frequency: frequency, // preserve any existing status (known/unknown)
            status: (vocabulary.has(word) && vocabulary.get(word).status) ? vocabulary.get(word).status : 'unreviewed', excluded: (vocabulary.has(word) && vocabulary.get(word).excluded) ? true : false, class: className });
        });
        newClass.vocabulary = new Map([...newClass.vocabulary.entries()].sort((a, b) => b[1].frequency - a[1].frequency));
        classes.push(newClass);
        currentClass = newClass.id;
        mergeVocabulary();
        displayClasses();
        displayWords();
        updateStats();
    }

    // Show sections
    statsBar.classList.add('active');
    filters.classList.add('active');
    wordsSection.classList.add('active');
    classSection.classList.add('active');
}

// helper for plain-text uploads (no SRT structure required)
async function parsePlainText(content, className) {
    // reuse title-prompt logic from parseSubtitles
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const defaultTitle = `Class - ${dd}-${mm}-${yyyy}`;

    const chosen = await promptForClassTitle(className || defaultTitle);
    if (!chosen) return;
    const title = chosen;

    // simply split lines into phrases for context
    const phrases = content.split(/\r?\n/).filter(l => l.trim());

    // build vocab similarly to subtitles
    const text = content.replace(/<[^>]*>/g, '').toLowerCase();
    const words = text.match(/\b[\p{L}']+\b/gu) || [];
    console.debug('parsed tokens total (plain):', words.length);
    const wordFreq = new Map();
    words.forEach(word => {
        if (word.length > 0) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
    });

    const classPayload = {
        id: String(Date.now()),
        name: title,
        date: new Date().toISOString(),
        phrases: phrases,
        vocabulary: Array.from(wordFreq.entries()).map(([word, freq]) => ({
            word,
            frequency: freq,
            status: (vocabulary.has(word) && vocabulary.get(word).status) ? vocabulary.get(word).status : 'unreviewed',
            excluded: (vocabulary.has(word) && vocabulary.get(word).excluded) ? true : false
        }))
    };

    try {
        await fetch('/api/vocab/class', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(classPayload)
        });
        await loadFromServer();
    } catch (err) {
        console.error('Failed to save class to server', err);
        // fallback same as parseSubtitles
        const newClass = {
            id: Date.now(),
            name: title,
            date: new Date().toISOString(),
            vocabulary: new Map(),
            phrases: phrases,
            totalWords: wordFreq.size,
            knownCount: 0,
            unknownCount: 0
        };
        wordFreq.forEach((frequency, word) => {
            newClass.vocabulary.set(word, { word: word, frequency: frequency,
            status: (vocabulary.has(word) && vocabulary.get(word).status) ? vocabulary.get(word).status : 'unreviewed', excluded: (vocabulary.has(word) && vocabulary.get(word).excluded) ? true : false, class: className });
        });
        newClass.vocabulary = new Map([...newClass.vocabulary.entries()].sort((a, b) => b[1].frequency - a[1].frequency));
        classes.push(newClass);
        currentClass = newClass.id;
        mergeVocabulary();
        displayClasses();
        displayWords();
        updateStats();
    }

    statsBar.classList.add('active');
    filters.classList.add('active');
    wordsSection.classList.add('active');
    classSection.classList.add('active');
}

function mergeVocabulary() {
    // Always merge vocabulary from ALL classes (ignore any per-class filter)
    vocabulary.clear();

    classes.forEach(cls => {
        cls.vocabulary.forEach((wordObj, word) => {
            if (!vocabulary.has(word)) {
                // copy excluded flag if present
                vocabulary.set(word, { ...wordObj, classes: [cls.name] });
            } else {
                const existing = vocabulary.get(word);
                existing.frequency += wordObj.frequency;
                // preserve excluded if any source marks it excluded
                existing.excluded = !!(existing.excluded || wordObj.excluded);
                if (!existing.classes.includes(cls.name)) {
                    existing.classes.push(cls.name);
                }
            }
        });
    });

    // Sort by frequency
    vocabulary = new Map([...vocabulary.entries()].sort((a, b) => b[1].frequency - a[1].frequency));
}

function displayClasses() {
    classGrid.innerHTML = ''; 

    classes.forEach(cls => {
        // Update counts (ignore excluded entries)
        let known = 0, unknown = 0, unreviewed = 0, total = 0;
        cls.vocabulary.forEach(word => {
            if (word.excluded) return; // skip excluded
            total++;
            if (word.status === 'known') known++;
            else if (word.status === 'unknown') unknown++;
            else unreviewed++;
        });
        cls.knownCount = known;
        cls.unknownCount = unknown;
        cls.totalWords = total;



        // Create card
        const card = document.createElement('div');
        card.className = 'class-card';
        if (currentClass === cls.id) card.classList.add('selected');

        const date = new Date(cls.date).toLocaleDateString();
        
        const classNameHtml = maybeLinkifyTitle(cls.name, null);

        card.innerHTML = `
            <div class="class-header">
                <div class="class-name">${classNameHtml}</div>
                <div class="class-date">${date}</div>
            </div>
            <div class="class-stats">
                <div class="class-stat">
                    <div class="class-stat-value">${cls.totalWords}</div>
                    <div class="class-stat-label">Words</div>
                </div>
                <div class="class-stat">
                    <div class="class-stat-value" style="color: #34d399">${known}</div>
                    <div class="class-stat-label">Known</div>
                </div>
                <div class="class-stat">
                    <div class="class-stat-value" style="color: #fb923c">${unknown}</div>
                    <div class="class-stat-label">Unknown</div>
                </div>
            </div>
            <div class="class-actions">
                <button class="class-btn delete">Delete</button>
            </div>
        `;

        const deleteBtn = card.querySelector('.delete');



        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete class "${cls.name}"?`)) return;
            try {
                const resp = await fetch(`/api/vocab/class/${encodeURIComponent(cls.id)}`, { method: 'DELETE' });
                if (!resp.ok) throw new Error('Delete failed');
                // reload classes from server
                await loadFromServer();
            } catch (err) {
                console.error('Failed to delete class on server, removing locally', err);
                classes = classes.filter(c => c.id !== cls.id);
                if (currentClass === cls.id) currentClass = classes.length > 0 ? classes[0].id : null;
                mergeVocabulary();
                displayClasses();
                displayWords();
                updateStats();
            }
        });

        // clicks on class cards no longer change selection — words view is global now
        // (intentionally left empty)

        classGrid.appendChild(card);
    });

    if (classes.length === 0) {
        classGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">📁</div>
                <h3>No classes yet</h3>
                <p>Upload your first subtitle file to get started</p>
            </div>
        `;
    }
}

function updateClassSelection() {
    document.querySelectorAll('.class-card').forEach(card => {
        card.classList.remove('selected');
    });
    const selectedCard = Array.from(document.querySelectorAll('.class-card')).find(card => {
        return classes.findIndex(c => c.id === currentClass) === Array.from(card.parentElement.children).indexOf(card);
    });
    if (selectedCard) selectedCard.classList.add('selected');
}



function displayWords() {
    wordsGrid.innerHTML = '';

    let filteredWords = Array.from(vocabulary.values());

    // Apply filter: excluded words are visible ONLY in the 'excluded' list
    if (currentFilter === 'excluded') {
        filteredWords = filteredWords.filter(w => w.excluded);
    } else {
        // remove excluded words from all other views
        filteredWords = filteredWords.filter(w => !w.excluded);
        if (currentFilter !== 'all') {
            filteredWords = filteredWords.filter(w => w.status === currentFilter);
        }
    }

    // Apply search
    const searchTerm = searchBox.value.toLowerCase();
    if (searchTerm) {
        filteredWords = filteredWords.filter(w => w.word.includes(searchTerm));
    }

    // Display words
    filteredWords.forEach(wordObj => {
        const card = document.createElement('div');
        card.className = `word-card ${wordObj.status}${wordObj.excluded ? ' excluded' : ''}`;
        

        
        // Different buttons based on status
        let statusButtons = '';
        if (wordObj.status === 'unknown') {
            statusButtons = `
                <div class="word-status">
                    <button class="status-btn know">✓ Mark as Known</button>
                </div>
                <button class="context-btn">📖 View in Context</button>
            `;
        } else {
            statusButtons = `
                <div class="word-status">
                    <button class="status-btn know">✓ Know</button>
                    <button class="status-btn dont-know">✗ Don't Know</button>
                </div>
            `;
        }
        
        card.innerHTML = `
            <button class="exclude-btn" title="${wordObj.excluded ? 'Include word' : 'Exclude word'}">${wordObj.excluded ? '↺' : '✕'}</button>
            <div class="word-text">${wordObj.word}</div>
            <div class="word-frequency">Appears ${wordObj.frequency} time${wordObj.frequency > 1 ? 's' : ''}</div>
            ${statusButtons}
        `;

        const knowBtn = card.querySelector('.know');
        const dontKnowBtn = card.querySelector('.dont-know');
        const contextBtn = card.querySelector('.context-btn');
        const excludeBtn = card.querySelector('.exclude-btn');

        if (knowBtn) {
            knowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateWordStatus(wordObj.word, 'known');
            });
        }

        if (dontKnowBtn) {
            dontKnowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateWordStatus(wordObj.word, 'unknown');
            });
        }

        if (contextBtn) {
            contextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openContextModal(wordObj.word, wordObj);
            });
        }

        if (excludeBtn) {
            excludeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateWordExcluded(wordObj.word, !wordObj.excluded);
            });
        }

        wordsGrid.appendChild(card);
    });

    if (filteredWords.length === 0) {
        wordsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">🔍</div>
                <h3>No words found</h3>
                <p>Try adjusting your filters or search term</p>
            </div>
        `;
    }
}

async function updateWordStatus(word, status) {
    // Update in global vocabulary (optimistic UI)
    const wordObj = vocabulary.get(word);
    if (wordObj) wordObj.status = status;

    // Update in all classes that contain this word
    classes.forEach(cls => {
        if (cls.vocabulary.has(word)) {
            cls.vocabulary.get(word).status = status;
        }
    });

    // Update UI immediately
    displayWords();
    displayClasses();
    updateStats();

    // Persist to server (non-blocking). Backend will upsert by word.
    try {
        await fetch('/api/vocab/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, status })
        });
    } catch (err) {
        console.warn('Failed to persist word status to server', err);
        // persistence failed; data may be out-of-sync until server is available
    }
}

async function updateWordExcluded(word, excluded) {
    // Update in global vocabulary (optimistic UI)
    const wordObj = vocabulary.get(word);
    if (wordObj) wordObj.excluded = excluded;

    // Update in all classes that contain this word
    classes.forEach(cls => {
        if (cls.vocabulary.has(word)) {
            cls.vocabulary.get(word).excluded = excluded;
        }
    });

    // Update UI immediately
    displayWords();
    displayClasses();
    updateStats();

    // Persist to server (non-blocking)
    try {
        await fetch('/api/vocab/exclude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, excluded })
        });
    } catch (err) {
        console.warn('Failed to persist excluded flag to server', err);
    }
}

function updateStats() {
    const total = Array.from(vocabulary.values()).filter(w => !w.excluded).length;
    const known = Array.from(vocabulary.values()).filter(w => !w.excluded && w.status === 'known').length;
    const unknown = Array.from(vocabulary.values()).filter(w => !w.excluded && w.status === 'unknown').length;
    const percentage = total > 0 ? Math.round((known / total) * 100) : 0;

    document.getElementById('totalWords').textContent = total;
    document.getElementById('knownWords').textContent = known;
    document.getElementById('unknownWords').textContent = unknown;
    document.getElementById('percentageKnown').textContent = percentage + '%';
    document.getElementById('progressFill').style.width = percentage + '%';
}

// Filter buttons
filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        displayWords();
    });
});

// Search box
searchBox.addEventListener('input', displayWords);

// Reset button
document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset all progress?')) return;

    classes.forEach(cls => {
        cls.vocabulary.forEach(wordObj => wordObj.status = 'unreviewed');
    });
    mergeVocabulary();
    displayWords();
    displayClasses();
    updateStats();

    // Persist reset to server
    try {
        await fetch('/api/vocab/reset', { method: 'POST' });
    } catch (err) {
        console.warn('Failed to reset statuses on server', err);
    }
});

// Export button
document.getElementById('exportBtn').addEventListener('click', () => {
    const data = {
        timestamp: new Date().toISOString(),
        classes: classes.map(cls => ({
            id: cls.id,
            name: cls.name,
            date: cls.date,
            totalWords: cls.totalWords,
            vocabulary: Array.from(cls.vocabulary.entries()).map(([word, obj]) => obj)
        }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vocabulary-progress-${Date.now()}.json`;
    a.click();
});

// Export unknown words as plain .txt (one word per line)
document.getElementById('exportUnknownBtn').addEventListener('click', () => {
    const words = Array.from(vocabulary.values())
        .filter(w => !w.excluded && w.status === 'unknown')
        .map(w => w.word);
    if (words.length === 0) {
        alert('No unknown words to export');
        return;
    }
    const blob = new Blob([words.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unknown-words-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
});

// Save / Load server buttons



// localStorage persistence removed — server is the single source of truth

// Import JSON (export format) -> POST /api/vocab/import then reload
const importJsonBtn = document.getElementById('importJsonBtn');
const importJsonFile = document.getElementById('importJsonFile');
importJsonBtn.addEventListener('click', () => importJsonFile.click());
importJsonFile.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
        const txt = await f.text();
        const obj = JSON.parse(txt);
        const payload = [];
        if (Array.isArray(obj.classes)) {
            for (const cls of obj.classes) {
                const clsName = cls.name || cls.id || 'Imported';
                const vocab = Array.isArray(cls.vocabulary) ? cls.vocabulary : (Array.isArray(cls.vocabulary?.[0]) ? cls.vocabulary.map(v=>v[1]) : []);
                for (const w of vocab) {
                    const word = (w.word || w[0] || '').toString().trim().toLowerCase();
                    if (!word) continue;
                    payload.push({
                        word,
                        translation: w.translation ?? null,
                        example: w.example ?? null,
                        tags: clsName,
                        status: w.status ?? 'unreviewed',
                        excluded: w.excluded ?? false,
                        class: clsName
                    });
                }
            }
        }

        if (payload.length === 0) {
            alert('No vocabulary entries found in file');
            return;
        }

        // Build class-level payloads and POST to /api/vocab/class
        const classMap = new Map();
        if (Array.isArray(obj.classes)) {
            for (const cls of obj.classes) {
                const clsName = cls.name || cls.id || `Imported-${Date.now()}`;
                const vocab = Array.isArray(cls.vocabulary) ? cls.vocabulary : (Array.isArray(cls.vocabulary?.[0]) ? cls.vocabulary.map(v=>v[1]) : []);
                const entries = [];
                for (const w of vocab) {
                    const word = (w.word || w[0] || '').toString().trim().toLowerCase();
                    if (!word) continue;
                    entries.push({ word, translation: w.translation ?? null, example: w.example ?? null, status: w.status ?? 'unreviewed', excluded: w.excluded ?? false });
                }
                classMap.set(clsName, { name: clsName, date: cls.date || new Date().toISOString(), phrases: cls.phrases || [], vocabulary: entries });
            }
        }

        // POST each class to server
        for (const [name, payloadClass] of classMap.entries()) {
            const resp = await fetch('/api/vocab/class', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(Date.now()) + '-' + Math.random().toString(36).slice(2,6), name: payloadClass.name, date: payloadClass.date, phrases: payloadClass.phrases, vocabulary: payloadClass.vocabulary }) });
            if (!resp.ok) throw new Error('Server class import failed');
        }

        await loadFromServer();
        // show not-reviewed tab after import
        currentFilter = 'unreviewed';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        const nr = document.querySelector('.filter-btn[data-filter="unreviewed"]');
        if (nr) nr.classList.add('active');
        alert('Imported classes to server and refreshed');
    } catch (err) {
        console.error(err);
        alert('Import failed: ' + (err.message || err));
    } finally {
        importJsonFile.value = '';
    }
});

// ----- Server sync helpers -----
async function importClassToServer(cls) {
    if (!cls || !cls.vocabulary) return;
    const vocab = [];
    const phrases = cls.phrases || [];
    cls.vocabulary.forEach((obj, word) => {
        const found = (phrases || []).find(p => {
            const t = (typeof p === 'string') ? p : (p.text || '');
            return t.toLowerCase().includes(word.toLowerCase());
        }) || null;
        const example = found ? ((typeof found === 'string') ? found : (found.text || '')) : null;
        vocab.push({ word: word, translation: null, example: example, tags: cls.name, status: obj.status || 'unreviewed', excluded: !!obj.excluded });
    });
    const payload = { id: String(cls.id || Date.now()), name: cls.name, date: cls.date || new Date().toISOString(), phrases: phrases, vocabulary: vocab };
    const resp = await fetch('/api/vocab/class', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!resp.ok) throw new Error('Server class import failed');
    return await resp.json();
}

async function importAllClassesToServer() {
    for (const cls of classes) {
        await importClassToServer(cls);
    }
    await loadFromServer();
}

async function loadFromServer() {
    const resp = await fetch('/api/vocab/classes');
    if (!resp.ok) throw new Error('Failed to fetch classes from server');
    const serverClasses = await resp.json();
    if (!Array.isArray(serverClasses)) return;

    classes = serverClasses.map(sc => {
        // build frequency map from class phrases because server doesn't persist frequency
        const phrasesText = (sc.phrases || []).map(p => typeof p === 'string' ? p : (p.text || '')).join(' ').toLowerCase().replace(/<[^>]*>/g, ' ');
        const phraseWords = phrasesText.match(/\b[a-z']+\b/g) || [];
        const freqMap = new Map();
        phraseWords.forEach(w => { if (w.length > 2) freqMap.set(w, (freqMap.get(w) || 0) + 1); });

        return {
            id: sc.id,
            name: sc.name,
            date: sc.date || new Date().toISOString(),
            phrases: sc.phrases || [],
            vocabulary: new Map((sc.vocabulary || []).map((v) => [ (v.word || '').toLowerCase(), {
                word: (v.word || '').toLowerCase(),
                frequency: v.frequency ?? (freqMap.get(((v.word||'').toLowerCase())) || 1),
                status: v.status || 'unreviewed',
                translation: v.translation || null,
                example: v.example || null,
                excluded: !!v.excluded,
                class: sc.id
            } ])),
            totalWords: (sc.vocabulary || []).filter(v => !v.excluded).length,
            knownCount: (sc.vocabulary || []).filter(v => !v.excluded && v.status === 'known').length,
            unknownCount: (sc.vocabulary || []).filter(v => !v.excluded && v.status === 'unknown').length
        };
    });

    // default to not-reviewed view after loading server data
    currentFilter = 'unreviewed';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const nrBtn = document.querySelector('.filter-btn[data-filter="unreviewed"]');
    if (nrBtn) nrBtn.classList.add('active');

    mergeVocabulary();
    displayClasses();
    displayWords();
    updateStats();
    statsBar.classList.add('active');
    filters.classList.add('active');
    wordsSection.classList.add('active');
    classSection.classList.add('active');
}