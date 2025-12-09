/**
 * Echo Image Viewer - Frontend Application
 * A clean, keyboard-friendly image gallery viewer with comic/manga reading modes
 */

// State
const state = {
    galleryRoot: '',  // Selected gallery root path (relative to BROWSE_ROOT)
    currentPath: '',
    images: [],
    currentImageIndex: 0,
    readingMode: 'comic', // 'comic' (L→R) or 'manga' (R→L)
    pendingEdits: [],
    menuVisible: false,
    originalImageDimensions: { width: 0, height: 0 },
    browsePath: '',  // Current path in folder browser
    recentGalleries: [],  // Recently used galleries
    blackout: false,  // Blackout mode active
    // Edit mode state
    editMode: {
        active: false,
        originalImage: null,  // Original Image object
        canvas: null,
        ctx: null,
        history: [],  // Array of canvas ImageData for undo
        historyIndex: -1,
        currentRotation: 0,
        flipH: false,
        flipV: false,
        cropData: null,  // { x, y, width, height } in original image coordinates
        resizeData: null  // { width, height }
    }
};

// DOM Elements
let welcomeView, browserView, viewerView, viewerImage, viewerMenu;
let folderGrid, imageGrid, breadcrumbs, emptyState;
let imageCounter, imageName, saveEditsBtn, galleryNameEl;
let folderBrowserDialog, browseFolderList, browseBreadcrumbs;

// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
            console.log('Service Worker registered:', registration.scope);
        })
        .catch((error) => {
            console.log('Service Worker registration failed:', error);
        });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM elements
    welcomeView = document.getElementById('welcome-view');
    browserView = document.getElementById('browser-view');
    viewerView = document.getElementById('viewer-view');
    viewerImage = document.getElementById('viewer-image');
    viewerMenu = document.getElementById('viewer-menu');
    folderGrid = document.getElementById('folder-grid');
    imageGrid = document.getElementById('image-grid');
    breadcrumbs = document.getElementById('breadcrumbs');
    emptyState = document.getElementById('empty-state');
    imageCounter = document.getElementById('image-counter');
    imageName = document.getElementById('image-name');
    saveEditsBtn = document.getElementById('save-edits-btn');
    galleryNameEl = document.getElementById('gallery-name');
    folderBrowserDialog = document.getElementById('folder-browser-dialog');
    browseFolderList = document.getElementById('browse-folder-list');
    browseBreadcrumbs = document.getElementById('browse-breadcrumbs');

    // Load saved theme
    const savedTheme = localStorage.getItem('echo-theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);

    // Load saved reading mode
    const savedMode = localStorage.getItem('echo-reading-mode') || 'comic';
    setReadingMode(savedMode, false);

    // Load recent galleries
    loadRecentGalleries();

    // Load saved gallery root
    const savedGallery = localStorage.getItem('echo-gallery-root');
    if (savedGallery) {
        state.galleryRoot = savedGallery;
        showBrowserView();
        loadPath('');
    } else {
        showWelcomeView();
    }

    // Initialize keyboard controls
    initKeyboardControls();

    // Initialize touch controls (for mobile gestures)
    initTouchControls();

    // Initialize click event delegation for data-action elements
    initClickHandlers();

    // Handle browser back/forward
    window.addEventListener('hashchange', handleHashChange);

    // Typewriter effect
    typeWriter();

    // Check auth status and show logout button if auth is enabled
    checkAuthStatus();
});

// Event delegation for data-action clicks
function initClickHandlers() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const path = target.dataset.path;
        const index = target.dataset.index;

        e.preventDefault();

        switch (action) {
            case 'select-gallery':
                selectGallery(path);
                break;
            case 'browse-folder':
                browseTo(path);
                break;
            case 'browse-to':
                browseTo(path);
                break;
            case 'load-path':
                loadPath(path);
                break;
            case 'open-viewer':
                openViewer(parseInt(index, 10));
                break;
        }
    });

    // Double-click to select folder in browser
    document.addEventListener('dblclick', (e) => {
        const target = e.target.closest('[data-action="browse-folder"]');
        if (!target) return;

        e.preventDefault();
        selectGallery(target.dataset.path);
    });
}

function handleHashChange() {
    const hash = window.location.hash.slice(1);
    const decodedHash = decodeURIComponent(hash);

    if (decodedHash.startsWith('view:')) {
        // Viewing an image
        const imagePath = decodedHash.slice(5);
        const imageIndex = state.images.findIndex(img => img.path === imagePath);
        if (imageIndex >= 0 && !viewerView.classList.contains('active')) {
            openViewer(imageIndex);
        }
    } else if (state.galleryRoot) {
        // Browsing within gallery - only reload if path actually changed
        const newPath = decodedHash || '';
        if (viewerView.classList.contains('active')) {
            // Coming back from viewer, just close it without reloading
            viewerView.classList.remove('active');
            browserView.classList.add('active');
            state.menuVisible = false;
            viewerMenu.classList.remove('visible');
        } else if (newPath !== state.currentPath) {
            // Path actually changed, reload
            loadPath(newPath);
        }
    }
}

// View Management
function showWelcomeView() {
    welcomeView.classList.add('active');
    browserView.classList.remove('active');
    viewerView.classList.remove('active');
    renderRecentGalleries();
}

function showBrowserView() {
    welcomeView.classList.remove('active');
    browserView.classList.add('active');
    viewerView.classList.remove('active');

    // Update gallery name display
    const name = state.galleryRoot.split('/').pop() || 'Gallery';
    galleryNameEl.textContent = name;
}

// Theme toggle
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('echo-theme', newTheme);
}

// Typewriter effect
function typeWriter() {
    const element = document.getElementById('typewriter');
    if (!element) return;

    const text = element.textContent;
    element.textContent = '';

    let i = 0;
    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(type, 100);
        }
    }

    setTimeout(type, 300);
}

// Recent Galleries
function loadRecentGalleries() {
    const saved = localStorage.getItem('echo-recent-galleries');
    state.recentGalleries = saved ? JSON.parse(saved) : [];
}

function saveRecentGalleries() {
    localStorage.setItem('echo-recent-galleries', JSON.stringify(state.recentGalleries));
}

function addToRecentGalleries(path) {
    // Remove if already exists
    state.recentGalleries = state.recentGalleries.filter(g => g.path !== path);

    // Add to front
    state.recentGalleries.unshift({
        path: path,
        name: path.split('/').pop() || 'Root',
        timestamp: Date.now()
    });

    // Keep only last 5
    state.recentGalleries = state.recentGalleries.slice(0, 5);

    saveRecentGalleries();
}

function renderRecentGalleries() {
    const container = document.getElementById('recent-galleries');
    if (!container) return;

    if (state.recentGalleries.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <h3>Recent Galleries</h3>
        ${state.recentGalleries.map(g => `
            <div class="recent-gallery-item" data-action="select-gallery" data-path="${escapeAttr(g.path)}">
                <span class="folder-icon">📁</span>
                <div class="gallery-info">
                    <div class="gallery-name">${escapeHtml(g.name)}</div>
                    <div class="gallery-path">${escapeHtml(g.path)}</div>
                </div>
            </div>
        `).join('')}
    `;
}

// Folder Browser
function openFolderBrowser() {
    state.browsePath = '';
    folderBrowserDialog.style.display = 'flex';
    loadBrowsePath('');
}

function closeFolderBrowser() {
    folderBrowserDialog.style.display = 'none';
}

async function loadBrowsePath(path) {
    state.browsePath = path;
    browseFolderList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const [foldersRes, infoRes] = await Promise.all([
            fetch(`/api/browse?path=${encodeURIComponent(path)}`),
            fetch(`/api/browse-info?path=${encodeURIComponent(path)}`)
        ]);

        if (!foldersRes.ok) throw new Error('Failed to load folders');

        const folders = await foldersRes.json();
        const info = await infoRes.json();

        // Update breadcrumbs
        renderBrowseBreadcrumbs(info.breadcrumbs);

        // Render folder list
        if (folders.length === 0) {
            browseFolderList.innerHTML = '<div class="browse-empty">No subfolders found</div>';
        } else {
            browseFolderList.innerHTML = folders.map(folder => `
                <div class="browse-folder-item"
                     data-action="browse-folder"
                     data-path="${escapeAttr(folder.path)}">
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">${escapeHtml(folder.name)}</span>
                    ${folder.has_images ? '<span class="has-images-badge">Has Images</span>' : ''}
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading browse path:', error);
        browseFolderList.innerHTML = `<div class="browse-empty">Error: ${error.message}</div>`;
    }
}

function renderBrowseBreadcrumbs(crumbs) {
    browseBreadcrumbs.innerHTML = crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        const separator = index > 0 ? '<span class="breadcrumb-separator">▸</span>' : '';
        return `
            ${separator}
            <a href="#" class="breadcrumb-link ${isLast ? 'active' : ''}"
               data-action="browse-to" data-path="${escapeAttr(crumb.path)}">
                ${escapeHtml(crumb.name)}
            </a>
        `;
    }).join('');
}

function browseTo(path) {
    loadBrowsePath(path);
}

function selectCurrentFolder() {
    selectGallery(state.browsePath);
}

function selectGallery(path) {
    state.galleryRoot = path;
    localStorage.setItem('echo-gallery-root', path);
    addToRecentGalleries(path);

    closeFolderBrowser();
    showBrowserView();
    loadPath('');
}

// Keyboard Controls
function initKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        // Don't handle if typing in an input
        if (e.target.tagName === 'INPUT') return;

        // Help overlay - ? key works everywhere
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            toggleHelp();
            return;
        }

        // Close help overlay on Escape
        const helpOverlay = document.getElementById('help-overlay');
        if (e.key === 'Escape' && helpOverlay.style.display === 'flex') {
            closeHelp();
            return;
        }

        // Close delete dialog on Escape
        const deleteDialog = document.getElementById('delete-dialog');
        if (e.key === 'Escape' && deleteDialog.style.display === 'flex') {
            closeDeleteDialog();
            return;
        }

        // Close folder browser on Escape
        if (e.key === 'Escape' && folderBrowserDialog.style.display === 'flex') {
            closeFolderBrowser();
            return;
        }

        // Blackout mode - B key toggles when viewer is active or blackout is active
        if (e.key.toLowerCase() === 'b') {
            if (state.blackout || viewerView.classList.contains('active')) {
                e.preventDefault();
                toggleBlackout();
                return;
            }
        }

        // Handle edit mode keyboard shortcuts first
        if (state.editMode.active) {
            if (handleEditModeKeyboard(e)) return;
        }

        // Only handle viewer keys when viewer is active
        if (!viewerView.classList.contains('active')) return;

        const key = e.key.toLowerCase();

        // VIM-style navigation + Arrow keys
        if (key === 'h' || key === 'arrowleft') {
            e.preventDefault();
            navigateImage(-1);
        } else if (key === 'l' || key === 'arrowright') {
            e.preventDefault();
            navigateImage(1);
        } else if (key === 'j' || key === 'arrowdown') {
            e.preventDefault();
            navigateImage(1);
        } else if (key === 'k' || key === 'arrowup') {
            e.preventDefault();
            navigateImage(-1);
        } else if (key === 'q' || key === 'escape') {
            e.preventDefault();
            if (state.menuVisible) {
                toggleMenu();
            } else {
                closeViewer();
            }
        } else if (key === ' ') {
            e.preventDefault();
            toggleMenu();
        } else if (key === 'g' && e.shiftKey) {
            e.preventDefault();
            goToImage(state.images.length - 1);
        } else if (key === 'g') {
            e.preventDefault();
            goToImage(0);
        } else if (key === 'm') {
            e.preventDefault();
            setReadingMode(state.readingMode === 'manga' ? 'comic' : 'manga');
        } else if (key === 'e') {
            e.preventDefault();
            openEditMode();
        } else if (key === 'delete' || key === 'x') {
            e.preventDefault();
            openDeleteDialog();
        }
    });
}

// Touch Controls (for mobile blackout gesture)
function initTouchControls() {
    let touchStartTime = 0;
    let touchFingers = 0;

    document.addEventListener('touchstart', (e) => {
        // Track number of fingers and start time
        touchFingers = e.touches.length;
        touchStartTime = Date.now();
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        // Check if it was a quick tap (less than 300ms)
        const touchDuration = Date.now() - touchStartTime;
        if (touchDuration > 300) return;

        // Three-finger tap toggles blackout when viewer is active or blackout is on
        if (touchFingers === 3) {
            if (state.blackout || viewerView.classList.contains('active')) {
                e.preventDefault();
                toggleBlackout();
            }
        }
    });
}

// Help overlay functions
function toggleHelp() {
    const helpOverlay = document.getElementById('help-overlay');
    if (helpOverlay.style.display === 'flex') {
        closeHelp();
    } else {
        openHelp();
    }
}

function openHelp() {
    const helpOverlay = document.getElementById('help-overlay');
    helpOverlay.style.display = 'flex';
}

function closeHelp() {
    const helpOverlay = document.getElementById('help-overlay');
    helpOverlay.style.display = 'none';
}

// Blackout functions
function toggleBlackout() {
    const blackoutOverlay = document.getElementById('blackout-overlay');
    if (state.blackout) {
        // Exit blackout mode
        state.blackout = false;
        blackoutOverlay.style.display = 'none';
    } else {
        // Enter blackout mode
        state.blackout = true;
        blackoutOverlay.style.display = 'flex';
    }
}

function exitBlackoutToHome() {
    // Exit blackout and close viewer, return to welcome/gallery view
    state.blackout = false;
    document.getElementById('blackout-overlay').style.display = 'none';
    closeViewer();
}

// Delete functions
function openDeleteDialog() {
    const image = state.images[state.currentImageIndex];
    if (!image) return;

    document.getElementById('delete-filename').textContent = image.name;
    document.getElementById('delete-dialog').style.display = 'flex';
}

function closeDeleteDialog() {
    document.getElementById('delete-dialog').style.display = 'none';
}

async function confirmDelete() {
    const image = state.images[state.currentImageIndex];
    if (!image) return;

    try {
        const response = await fetch(`/api/delete?path=${encodeURIComponent(image.path)}&gallery_root=${encodeURIComponent(state.galleryRoot)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete');
        }

        closeDeleteDialog();

        // Remove from images array and navigate
        state.images.splice(state.currentImageIndex, 1);

        if (state.images.length === 0) {
            // No more images, go back to gallery
            closeViewer();
            await loadPath(state.currentPath);
        } else {
            // Move to next image (or previous if we were at the end)
            if (state.currentImageIndex >= state.images.length) {
                state.currentImageIndex = state.images.length - 1;
            }
            loadCurrentImage();
        }

    } catch (error) {
        console.error('Delete error:', error);
        alert(`Failed to delete: ${error.message}`);
        closeDeleteDialog();
    }
}

// API Functions
async function loadPath(path) {
    if (!state.galleryRoot) {
        showWelcomeView();
        return;
    }

    state.currentPath = path;
    window.location.hash = path;

    // Show loading state
    folderGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    imageGrid.innerHTML = '';
    emptyState.style.display = 'none';

    const headers = {
        'X-Gallery-Root': state.galleryRoot
    };

    try {
        // Fetch folders and images in parallel
        const [foldersRes, imagesRes, pathInfoRes] = await Promise.all([
            fetch(`/api/folders?path=${encodeURIComponent(path)}`, { headers }),
            fetch(`/api/images?path=${encodeURIComponent(path)}`, { headers }),
            fetch(`/api/path-info?path=${encodeURIComponent(path)}`)
        ]);

        if (!foldersRes.ok || !imagesRes.ok) {
            throw new Error('Failed to load content');
        }

        const folders = await foldersRes.json();
        const images = await imagesRes.json();
        const pathInfo = await pathInfoRes.json();

        state.images = images;

        // Update breadcrumbs
        renderBreadcrumbs(pathInfo.breadcrumbs);

        // Render folders
        renderFolders(folders);

        // Render images
        renderImages(images);

        // Show appropriate state messages
        const noImagesNotice = document.getElementById('no-images-notice');

        if (folders.length === 0 && images.length === 0) {
            // Completely empty folder
            emptyState.style.display = 'block';
            if (noImagesNotice) noImagesNotice.style.display = 'none';
        } else if (folders.length > 0 && images.length === 0) {
            // Has subfolders but no images
            emptyState.style.display = 'none';
            if (noImagesNotice) noImagesNotice.style.display = 'block';
        } else {
            // Has images (and maybe folders)
            emptyState.style.display = 'none';
            if (noImagesNotice) noImagesNotice.style.display = 'none';
        }

    } catch (error) {
        console.error('Error loading path:', error);
        // Show a cleaner error message
        folderGrid.innerHTML = '';
        imageGrid.innerHTML = '';
        emptyState.innerHTML = `
            <div class="empty-icon">⚠️</div>
            <p>Could not load this folder</p>
            <p class="error-detail">${escapeHtml(error.message)}</p>
        `;
        emptyState.style.display = 'block';
    }
}

function renderBreadcrumbs(crumbs) {
    breadcrumbs.innerHTML = crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        const separator = index > 0 ? '<span class="breadcrumb-separator">▸</span>' : '';
        return `
            ${separator}
            <a href="#${encodeURIComponent(crumb.path)}"
               class="breadcrumb-link ${isLast ? 'active' : ''}"
               data-action="load-path" data-path="${escapeAttr(crumb.path)}">
                ${escapeHtml(crumb.name)}
            </a>
        `;
    }).join('');
}

function renderFolders(folders) {
    if (folders.length === 0) {
        folderGrid.innerHTML = '';
        return;
    }

    const galleryParam = encodeURIComponent(state.galleryRoot);

    folderGrid.innerHTML = folders.map(folder => `
        <div class="folder-card" data-action="load-path" data-path="${escapeAttr(folder.path)}">
            <div class="folder-thumbnail">
                ${folder.thumbnail
                    ? `<img src="${folder.thumbnail}?thumbnail=true&gallery_root=${galleryParam}" alt="${escapeAttr(folder.name)}" loading="lazy">`
                    : '<span class="folder-icon">📁</span>'
                }
            </div>
            <div class="folder-name">${escapeHtml(folder.name)}</div>
            <div class="folder-meta">
                ${folder.has_images ? '🖼' : ''}
                ${folder.has_subfolders ? '📂' : ''}
            </div>
        </div>
    `).join('');
}

function renderImages(images) {
    if (images.length === 0) {
        imageGrid.innerHTML = '';
        return;
    }

    const galleryParam = encodeURIComponent(state.galleryRoot);

    imageGrid.innerHTML = images.map((image, index) => `
        <div class="image-card" data-action="open-viewer" data-index="${index}">
            <img class="image-thumbnail"
                 src="/api/image/${encodeURIComponent(image.path)}?thumbnail=true&gallery_root=${galleryParam}"
                 alt="${escapeAttr(image.name)}"
                 loading="lazy">
            <div class="image-name">${escapeHtml(image.name)}</div>
        </div>
    `).join('');
}

// Viewer Functions
function openViewer(index) {
    state.currentImageIndex = index;
    state.pendingEdits = [];
    updateSaveButton();

    browserView.classList.remove('active');
    viewerView.classList.add('active');

    loadCurrentImage();
    window.location.hash = `view:${state.images[index].path}`;
}

function closeViewer() {
    viewerView.classList.remove('active');
    browserView.classList.add('active');
    state.menuVisible = false;
    viewerMenu.classList.remove('visible');
    window.location.hash = state.currentPath;
}

function loadCurrentImage() {
    const image = state.images[state.currentImageIndex];
    if (!image) return;

    const galleryParam = encodeURIComponent(state.galleryRoot);
    const imageUrl = `/api/image/${encodeURIComponent(image.path)}?gallery_root=${galleryParam}`;
    const counterText = `${state.currentImageIndex + 1} / ${state.images.length}`;

    viewerImage.src = imageUrl;

    // Update menu counter and name
    imageCounter.textContent = counterText;
    imageName.textContent = image.name;

    // Update bottom bar counter and name
    const bottomCounter = document.getElementById('bottom-image-counter');
    const bottomName = document.getElementById('bottom-image-name');
    if (bottomCounter) bottomCounter.textContent = counterText;
    if (bottomName) bottomName.textContent = image.name;

    // Update the "Open" link to download/open the image directly
    const openLink = document.getElementById('open-file-link');
    if (openLink) {
        openLink.href = imageUrl;
        openLink.download = image.name;
    }

    // Fetch and display file info (path, size)
    loadFileInfo(image.path);

    // Get image dimensions when loaded
    viewerImage.onload = () => {
        state.originalImageDimensions = {
            width: viewerImage.naturalWidth,
            height: viewerImage.naturalHeight
        };
    };
}

async function loadFileInfo(imagePath) {
    const pathDisplay = document.getElementById('image-path-display');
    if (!pathDisplay) return;

    try {
        const galleryParam = encodeURIComponent(state.galleryRoot);
        const response = await fetch(`/api/file-info?path=${encodeURIComponent(imagePath)}&gallery_root=${galleryParam}`);

        if (response.ok) {
            const info = await response.json();
            pathDisplay.innerHTML = `
                <span class="file-size">${info.size_human}</span>
                <span class="file-path" title="${escapeAttr(info.real_path)}">${escapeHtml(info.real_path)}</span>
            `;
        }
    } catch (error) {
        console.error('Error loading file info:', error);
        pathDisplay.innerHTML = '';
    }
}

function navigateImage(direction) {
    // In manga mode, reverse the direction
    const actualDirection = state.readingMode === 'manga' ? -direction : direction;

    let newIndex = state.currentImageIndex + actualDirection;

    // Wrap around
    if (newIndex < 0) {
        newIndex = state.images.length - 1;
    } else if (newIndex >= state.images.length) {
        newIndex = 0;
    }

    goToImage(newIndex);
}

function goToImage(index) {
    if (index < 0 || index >= state.images.length) return;

    state.currentImageIndex = index;
    state.pendingEdits = [];
    updateSaveButton();
    loadCurrentImage();
    window.location.hash = `view:${state.images[index].path}`;
}

function toggleMenu() {
    state.menuVisible = !state.menuVisible;
    viewerMenu.classList.toggle('visible', state.menuVisible);
}

// Reading Mode
function setReadingMode(mode, save = true) {
    state.readingMode = mode;

    document.getElementById('mode-comic').classList.toggle('active', mode === 'comic');
    document.getElementById('mode-manga').classList.toggle('active', mode === 'manga');

    if (save) {
        localStorage.setItem('echo-reading-mode', mode);
    }
}

// Image Editing
function rotateImage(angle) {
    state.pendingEdits.push({ type: 'rotate', angle });
    updateSaveButton();
    showEditPreview();
}

function flipImage(direction) {
    state.pendingEdits.push({ type: 'flip', direction });
    updateSaveButton();
    showEditPreview();
}

function openCropMode() {
    const overlay = document.getElementById('crop-overlay');
    overlay.style.display = 'flex';
}

function applyCrop() {
    cancelCrop();
}

function cancelCrop() {
    document.getElementById('crop-overlay').style.display = 'none';
}

function openResizeDialog() {
    const dialog = document.getElementById('resize-dialog');
    const widthInput = document.getElementById('resize-width');
    const heightInput = document.getElementById('resize-height');

    widthInput.value = state.originalImageDimensions.width;
    heightInput.value = state.originalImageDimensions.height;

    dialog.style.display = 'flex';

    const aspectCheckbox = document.getElementById('resize-aspect');
    const aspectRatio = state.originalImageDimensions.width / state.originalImageDimensions.height;

    widthInput.oninput = () => {
        if (aspectCheckbox.checked) {
            heightInput.value = Math.round(widthInput.value / aspectRatio);
        }
    };

    heightInput.oninput = () => {
        if (aspectCheckbox.checked) {
            widthInput.value = Math.round(heightInput.value * aspectRatio);
        }
    };
}

function applyResize() {
    const width = parseInt(document.getElementById('resize-width').value);
    const height = parseInt(document.getElementById('resize-height').value);

    if (width > 0 && height > 0) {
        state.pendingEdits.push({ type: 'resize', width, height });
        updateSaveButton();
    }

    closeResizeDialog();
}

function closeResizeDialog() {
    document.getElementById('resize-dialog').style.display = 'none';
}

function showEditPreview() {
    console.log('Pending edits:', state.pendingEdits);
}

function updateSaveButton() {
    // Legacy function - save button was removed in favor of edit mode
    if (saveEditsBtn) {
        saveEditsBtn.disabled = state.pendingEdits.length === 0;
    }
}

async function saveEdits() {
    // Legacy function - kept for compatibility but edit mode is now preferred
    if (state.pendingEdits.length === 0) return;
    if (!saveEditsBtn) return;

    const image = state.images[state.currentImageIndex];
    const prefix = document.getElementById('save-prefix')?.value || '';
    const suffix = document.getElementById('save-suffix')?.value || '_edited';

    saveEditsBtn.disabled = true;
    saveEditsBtn.textContent = 'Saving...';

    try {
        const response = await fetch('/api/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: image.path,
                operations: state.pendingEdits,
                output_prefix: prefix,
                output_suffix: suffix,
                gallery_root: state.galleryRoot
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to save');
        }

        const result = await response.json();

        state.pendingEdits = [];
        updateSaveButton();

        await loadPath(state.currentPath);

        alert(`Image saved as: ${result.output_path}`);

    } catch (error) {
        console.error('Save error:', error);
        alert(`Failed to save: ${error.message}`);
    } finally {
        if (saveEditsBtn) {
            saveEditsBtn.textContent = 'Save Edited Copy';
        }
        updateSaveButton();
    }
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    // Escape for use in HTML attributes (data-* attributes)
    return text
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ==========================================
// EDIT MODE - Live Preview Image Editing
// ==========================================

function openEditMode() {
    const image = state.images[state.currentImageIndex];
    if (!image) return;

    // Hide the viewer menu
    state.menuVisible = false;
    viewerMenu.classList.remove('visible');

    // Reset edit state
    state.editMode = {
        active: true,
        originalImage: null,
        canvas: document.getElementById('edit-canvas'),
        ctx: null,
        history: [],
        historyIndex: -1,
        currentRotation: 0,
        flipH: false,
        flipV: false,
        cropData: null,
        resizeData: null
    };

    // Update filename display
    const filename = image.name;
    const lastDot = filename.lastIndexOf('.');
    const baseName = lastDot > 0 ? filename.substring(0, lastDot) : filename;
    const extension = lastDot > 0 ? filename.substring(lastDot) : '';

    document.getElementById('edit-filename').textContent = baseName;
    document.getElementById('edit-extension').textContent = extension;

    // Show edit mode overlay
    document.getElementById('edit-mode-overlay').style.display = 'flex';

    // Load the image onto canvas
    loadImageForEditing();
}

function loadImageForEditing() {
    const image = state.images[state.currentImageIndex];
    const galleryParam = encodeURIComponent(state.galleryRoot);
    const imageUrl = `/api/image/${encodeURIComponent(image.path)}?gallery_root=${galleryParam}`;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
        state.editMode.originalImage = img;
        state.editMode.canvas = document.getElementById('edit-canvas');
        state.editMode.ctx = state.editMode.canvas.getContext('2d');

        // Set canvas size to image size
        state.editMode.canvas.width = img.width;
        state.editMode.canvas.height = img.height;

        // Draw original image
        state.editMode.ctx.drawImage(img, 0, 0);

        // Save initial state to history
        saveEditHistory();

        // Update UI
        updateEditUI();
    };

    img.onerror = () => {
        alert('Failed to load image for editing');
        closeEditMode();
    };

    img.src = imageUrl;
}

function closeEditMode() {
    state.editMode.active = false;
    document.getElementById('edit-mode-overlay').style.display = 'none';

    // Close any open dialogs
    document.getElementById('edit-crop-overlay').style.display = 'none';
    document.getElementById('edit-resize-dialog').style.display = 'none';
}

function updateEditUI() {
    const canvas = state.editMode.canvas;
    const historyLen = state.editMode.history.length;
    const historyIdx = state.editMode.historyIndex;

    // Update dimensions display
    document.getElementById('edit-dimensions').textContent =
        `${canvas.width} × ${canvas.height}`;

    // Update changes count
    const changesCount = historyIdx;
    document.getElementById('edit-changes-count').textContent =
        changesCount === 0 ? 'No changes' :
        changesCount === 1 ? '1 change' :
        `${changesCount} changes`;

    // Update undo/redo buttons
    document.getElementById('edit-undo-btn').disabled = historyIdx <= 0;
    document.getElementById('edit-redo-btn').disabled = historyIdx >= historyLen - 1;

    // Update save button
    document.getElementById('edit-save-btn').disabled = historyIdx <= 0;
}

function saveEditHistory() {
    const canvas = state.editMode.canvas;
    const ctx = state.editMode.ctx;

    // Remove any redo history
    if (state.editMode.historyIndex < state.editMode.history.length - 1) {
        state.editMode.history = state.editMode.history.slice(0, state.editMode.historyIndex + 1);
    }

    // Save current state
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.editMode.history.push({
        imageData: imageData,
        width: canvas.width,
        height: canvas.height
    });
    state.editMode.historyIndex = state.editMode.history.length - 1;

    // Limit history size to prevent memory issues
    if (state.editMode.history.length > 50) {
        state.editMode.history.shift();
        state.editMode.historyIndex--;
    }

    updateEditUI();
}

function editUndo() {
    if (state.editMode.historyIndex <= 0) return;

    state.editMode.historyIndex--;
    restoreFromHistory();
}

function editRedo() {
    if (state.editMode.historyIndex >= state.editMode.history.length - 1) return;

    state.editMode.historyIndex++;
    restoreFromHistory();
}

function restoreFromHistory() {
    const historyEntry = state.editMode.history[state.editMode.historyIndex];
    const canvas = state.editMode.canvas;
    const ctx = state.editMode.ctx;

    canvas.width = historyEntry.width;
    canvas.height = historyEntry.height;
    ctx.putImageData(historyEntry.imageData, 0, 0);

    updateEditUI();
}

function editReset() {
    if (state.editMode.history.length <= 1) return;

    if (!confirm('Reset all edits? This cannot be undone.')) return;

    // Go back to first history entry
    state.editMode.historyIndex = 0;
    state.editMode.history = [state.editMode.history[0]];
    restoreFromHistory();
}

// Transform operations
function editRotateLeft() {
    rotateCanvas(-90);
}

function editRotateRight() {
    rotateCanvas(90);
}

function rotateCanvas(degrees) {
    const canvas = state.editMode.canvas;
    const ctx = state.editMode.ctx;

    // Create a temporary canvas
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    // For 90 or -90 degree rotation, swap width and height
    if (degrees === 90 || degrees === -90) {
        tempCanvas.width = canvas.height;
        tempCanvas.height = canvas.width;
    } else {
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
    }

    // Rotate
    tempCtx.save();
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    tempCtx.rotate((degrees * Math.PI) / 180);
    tempCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    tempCtx.restore();

    // Copy back to main canvas
    canvas.width = tempCanvas.width;
    canvas.height = tempCanvas.height;
    ctx.drawImage(tempCanvas, 0, 0);

    saveEditHistory();
}

function editFlipH() {
    flipCanvas('horizontal');
}

function editFlipV() {
    flipCanvas('vertical');
}

function flipCanvas(direction) {
    const canvas = state.editMode.canvas;
    const ctx = state.editMode.ctx;

    // Create a temporary canvas
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    // Copy current state
    tempCtx.drawImage(canvas, 0, 0);

    // Clear and flip
    ctx.save();
    if (direction === 'horizontal') {
        ctx.scale(-1, 1);
        ctx.drawImage(tempCanvas, -canvas.width, 0);
    } else {
        ctx.scale(1, -1);
        ctx.drawImage(tempCanvas, 0, -canvas.height);
    }
    ctx.restore();

    saveEditHistory();
}

// Crop functionality
let cropState = {
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    selectionBox: null
};

function openEditCrop() {
    const overlay = document.getElementById('edit-crop-overlay');
    overlay.style.display = 'flex';

    cropState.active = true;

    // Add mouse event listeners to the preview area
    const previewArea = document.querySelector('.edit-preview-area');
    previewArea.addEventListener('mousedown', startCropSelection);
    document.addEventListener('mousemove', updateCropSelection);
    document.addEventListener('mouseup', endCropSelection);
}

function startCropSelection(e) {
    if (!cropState.active) return;

    const canvas = state.editMode.canvas;
    const rect = canvas.getBoundingClientRect();

    cropState.startX = e.clientX - rect.left;
    cropState.startY = e.clientY - rect.top;
    cropState.dragging = true;

    // Create selection box
    if (cropState.selectionBox) {
        cropState.selectionBox.remove();
    }

    cropState.selectionBox = document.createElement('div');
    cropState.selectionBox.className = 'crop-selection-box';
    cropState.selectionBox.style.left = cropState.startX + rect.left + 'px';
    cropState.selectionBox.style.top = cropState.startY + rect.top + 'px';
    cropState.selectionBox.style.width = '0px';
    cropState.selectionBox.style.height = '0px';

    document.querySelector('.edit-preview-area').appendChild(cropState.selectionBox);
}

function updateCropSelection(e) {
    if (!cropState.active || !cropState.dragging || !cropState.selectionBox) return;

    const canvas = state.editMode.canvas;
    const rect = canvas.getBoundingClientRect();

    cropState.currentX = e.clientX - rect.left;
    cropState.currentY = e.clientY - rect.top;

    const x = Math.min(cropState.startX, cropState.currentX);
    const y = Math.min(cropState.startY, cropState.currentY);
    const width = Math.abs(cropState.currentX - cropState.startX);
    const height = Math.abs(cropState.currentY - cropState.startY);

    cropState.selectionBox.style.left = (x + rect.left) + 'px';
    cropState.selectionBox.style.top = (y + rect.top) + 'px';
    cropState.selectionBox.style.width = width + 'px';
    cropState.selectionBox.style.height = height + 'px';
}

function endCropSelection(e) {
    if (!cropState.active) return;
    cropState.dragging = false;
}

function applyCropSelection() {
    if (!cropState.selectionBox) {
        cancelCropSelection();
        return;
    }

    const canvas = state.editMode.canvas;
    const ctx = state.editMode.ctx;
    const rect = canvas.getBoundingClientRect();

    // Calculate crop area in canvas coordinates
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const boxRect = cropState.selectionBox.getBoundingClientRect();
    const cropX = Math.max(0, (boxRect.left - rect.left) * scaleX);
    const cropY = Math.max(0, (boxRect.top - rect.top) * scaleY);
    const cropWidth = Math.min(canvas.width - cropX, boxRect.width * scaleX);
    const cropHeight = Math.min(canvas.height - cropY, boxRect.height * scaleY);

    if (cropWidth < 10 || cropHeight < 10) {
        alert('Crop area too small');
        cancelCropSelection();
        return;
    }

    // Get the cropped image data
    const imageData = ctx.getImageData(cropX, cropY, cropWidth, cropHeight);

    // Resize canvas and put cropped data
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    ctx.putImageData(imageData, 0, 0);

    saveEditHistory();
    cancelCropSelection();
}

function cancelCropSelection() {
    cropState.active = false;
    cropState.dragging = false;

    if (cropState.selectionBox) {
        cropState.selectionBox.remove();
        cropState.selectionBox = null;
    }

    document.getElementById('edit-crop-overlay').style.display = 'none';

    // Remove event listeners
    const previewArea = document.querySelector('.edit-preview-area');
    previewArea.removeEventListener('mousedown', startCropSelection);
    document.removeEventListener('mousemove', updateCropSelection);
    document.removeEventListener('mouseup', endCropSelection);
}

// Resize functionality
function openEditResize() {
    const canvas = state.editMode.canvas;
    const dialog = document.getElementById('edit-resize-dialog');

    document.getElementById('edit-resize-width').value = canvas.width;
    document.getElementById('edit-resize-height').value = canvas.height;

    dialog.style.display = 'flex';

    // Set up aspect ratio linking
    const aspectRatio = canvas.width / canvas.height;
    const widthInput = document.getElementById('edit-resize-width');
    const heightInput = document.getElementById('edit-resize-height');
    const aspectCheckbox = document.getElementById('edit-resize-aspect');

    widthInput.oninput = () => {
        if (aspectCheckbox.checked) {
            heightInput.value = Math.round(widthInput.value / aspectRatio);
        }
    };

    heightInput.oninput = () => {
        if (aspectCheckbox.checked) {
            widthInput.value = Math.round(heightInput.value * aspectRatio);
        }
    };
}

function applyResizeEdit() {
    const newWidth = parseInt(document.getElementById('edit-resize-width').value);
    const newHeight = parseInt(document.getElementById('edit-resize-height').value);

    if (newWidth < 1 || newHeight < 1) {
        alert('Invalid dimensions');
        return;
    }

    const canvas = state.editMode.canvas;
    const ctx = state.editMode.ctx;

    // Create temporary canvas with current image
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    tempCtx.drawImage(canvas, 0, 0);

    // Resize main canvas
    canvas.width = newWidth;
    canvas.height = newHeight;

    // Draw scaled image
    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, newWidth, newHeight);

    saveEditHistory();
    cancelResizeEdit();
}

function cancelResizeEdit() {
    document.getElementById('edit-resize-dialog').style.display = 'none';
}

// Save edited image
async function saveEditedImage() {
    if (state.editMode.historyIndex <= 0) return;

    const image = state.images[state.currentImageIndex];
    const canvas = state.editMode.canvas;

    const prefix = document.getElementById('edit-prefix').value;
    const suffix = document.getElementById('edit-suffix').value || '_edited';

    // Convert canvas to blob
    canvas.toBlob(async (blob) => {
        const saveBtn = document.getElementById('edit-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            // Build operations list from history
            // For simplicity, we send the final image data
            const operations = [{ type: 'canvas_data' }];

            // Create FormData with the image blob
            const formData = new FormData();
            formData.append('image', blob, image.name);
            formData.append('path', image.path);
            formData.append('output_prefix', prefix);
            formData.append('output_suffix', suffix);
            formData.append('gallery_root', state.galleryRoot);

            const response = await fetch('/api/edit-upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to save');
            }

            const result = await response.json();
            alert(`Image saved as: ${result.output_path}`);

            closeEditMode();
            await loadPath(state.currentPath);

        } catch (error) {
            console.error('Save error:', error);
            alert(`Failed to save: ${error.message}`);
        } finally {
            saveBtn.textContent = 'Save Copy';
            saveBtn.disabled = false;
            updateEditUI();
        }
    }, 'image/png');
}

// Edit mode keyboard shortcuts
function handleEditModeKeyboard(e) {
    if (!state.editMode.active) return false;

    // Don't handle if typing in an input
    if (e.target.tagName === 'INPUT') return false;

    const key = e.key.toLowerCase();

    if (key === 'escape') {
        e.preventDefault();
        closeEditMode();
        return true;
    } else if (key === 'r' && !e.shiftKey) {
        e.preventDefault();
        editRotateLeft();
        return true;
    } else if (key === 'r' && e.shiftKey) {
        e.preventDefault();
        editRotateRight();
        return true;
    } else if (key === 'f' && !e.shiftKey) {
        e.preventDefault();
        editFlipH();
        return true;
    } else if (key === 'f' && e.shiftKey) {
        e.preventDefault();
        editFlipV();
        return true;
    } else if (key === 'u' || (e.ctrlKey && key === 'z')) {
        e.preventDefault();
        editUndo();
        return true;
    } else if (e.ctrlKey && key === 'y') {
        e.preventDefault();
        editRedo();
        return true;
    } else if (key === 'c' && !e.ctrlKey) {
        e.preventDefault();
        openEditCrop();
        return true;
    } else if (key === 's' && !e.ctrlKey) {
        e.preventDefault();
        openEditResize();
        return true;
    }

    return false;
}

// Make functions globally available
window.toggleTheme = toggleTheme;
window.loadPath = loadPath;
window.openViewer = openViewer;
window.closeViewer = closeViewer;
window.navigateImage = navigateImage;
window.toggleMenu = toggleMenu;
window.setReadingMode = setReadingMode;
window.rotateImage = rotateImage;
window.flipImage = flipImage;
window.openCropMode = openCropMode;
window.applyCrop = applyCrop;
window.cancelCrop = cancelCrop;
window.openResizeDialog = openResizeDialog;
window.applyResize = applyResize;
window.closeResizeDialog = closeResizeDialog;
window.saveEdits = saveEdits;
window.openFolderBrowser = openFolderBrowser;
window.closeFolderBrowser = closeFolderBrowser;
window.browseTo = browseTo;
window.selectCurrentFolder = selectCurrentFolder;
window.selectGallery = selectGallery;
// Edit mode functions
window.openEditMode = openEditMode;
window.closeEditMode = closeEditMode;
window.editRotateLeft = editRotateLeft;
window.editRotateRight = editRotateRight;
window.editFlipH = editFlipH;
window.editFlipV = editFlipV;
window.editUndo = editUndo;
window.editRedo = editRedo;
window.editReset = editReset;
window.openEditCrop = openEditCrop;
window.applyCropSelection = applyCropSelection;
window.cancelCropSelection = cancelCropSelection;
window.openEditResize = openEditResize;
window.applyResizeEdit = applyResizeEdit;
window.cancelResizeEdit = cancelResizeEdit;
window.saveEditedImage = saveEditedImage;
// Help and delete functions
window.openHelp = openHelp;
window.closeHelp = closeHelp;
window.toggleHelp = toggleHelp;
window.openDeleteDialog = openDeleteDialog;
window.closeDeleteDialog = closeDeleteDialog;
window.confirmDelete = confirmDelete;
// Auth functions
window.logout = logout;

// Authentication
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();

        if (data.enabled) {
            // Show logout buttons
            const logoutBtnWelcome = document.getElementById('logout-btn-welcome');
            const logoutBtnBrowser = document.getElementById('logout-btn-browser');
            if (logoutBtnWelcome) logoutBtnWelcome.style.display = 'block';
            if (logoutBtnBrowser) logoutBtnBrowser.style.display = 'block';
        }
    } catch (error) {
        // Auth endpoint not available or error, just continue without showing logout
        console.log('Auth status check failed:', error);
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    }
    // Redirect to login page (or reload to trigger auth middleware)
    window.location.href = '/';
}
