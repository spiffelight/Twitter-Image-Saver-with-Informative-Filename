// ==UserScript==
// @name         Twitter Image Saver with Info (Robust)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Download Twitter images with auto-generated filenames. Enhanced tweet info extraction.
// @author       You
// @match        https://twitter.com/*
// @match        https://x.com/*
// @grant        GM_xmlhttpRequest
// @connect      twimg.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ---------- Configuration ----------
    const BUTTON_TEXT = '💾';
    const BUTTON_TITLE = 'Download image';
    const BUTTON_SIZE = '28px';
    const BUTTON_FONT_SIZE = '16px';
    const DEBUG = true;  // Set to false to disable console logs

    function log(...args) {
        if (DEBUG) console.log('[TwImgSaver]', ...args);
    }

    // ---------- Helper Functions ----------
    function sanitizeFilename(str) {
        return str.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
    }

    function formatDate(date) {
        const pad = n => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    }

    // ---------- Extract Tweet Info (with fallbacks) ----------
    function getTweetInfo(img) {
        log('getTweetInfo called for image:', img.src.slice(0, 100));

        // 1. Standard tweet article
        let tweet = img.closest('article[data-testid="tweet"]');
        if (!tweet) {
            log('No article[data-testid="tweet"] found, trying div fallback.');
            // Sometimes it's a div with the same data-testid
            tweet = img.closest('div[data-testid="tweet"]');
        }

        // 2. If still not found, try to find any ancestor that contains a status link and a time element
        if (!tweet) {
            log('No div fallback, searching for ancestor with /status/ link.');
            let ancestor = img.parentElement;
            while (ancestor && ancestor !== document.body) {
                if (ancestor.querySelector('a[href*="/status/"]') && ancestor.querySelector('time')) {
                    tweet = ancestor;
                    break;
                }
                ancestor = ancestor.parentElement;
            }
        }

        // 3. If still nothing, maybe the image is inside a modal (photo viewer)
        if (!tweet) {
            log('No ancestor with status link found. Trying modal detection.');
            const modal = document.querySelector('div[aria-labelledby="modal-header"]');
            if (modal) {
                tweet = modal;
            }
        }

        if (!tweet) {
            log('ERROR: Could not locate any tweet container.');
            return null;
        }

        const info = { username: null, tweetId: null, date: null, index: 0 };

        // Username: search within the tweet container
        const userLink = tweet.querySelector('a[href^="/"][role="link"]');
        if (userLink) {
            const href = userLink.getAttribute('href');
            const match = href.match(/^\/([^/]+)/);
            if (match) info.username = match[1];
            if (!info.username) {
                const span = userLink.querySelector('span');
                if (span && span.textContent.includes('@')) {
                    info.username = span.textContent.replace('@', '').trim();
                }
            }
        }

        // Tweet ID: from any status link inside the container
        const statusLink = tweet.querySelector('a[href*="/status/"]');
        if (statusLink) {
            const match = statusLink.getAttribute('href').match(/\/status\/(\d+)/);
            if (match) info.tweetId = match[1];
        }

        // Date: from <time> element
        const timeEl = tweet.querySelector('time');
        if (timeEl && timeEl.dateTime) {
            info.date = new Date(timeEl.dateTime);
        }

        // Image index: count media images within the same tweet container
        const allMediaImgs = tweet.querySelectorAll('img[src*="twimg.com/media"]');
        const imgsArray = Array.from(allMediaImgs);
        info.index = imgsArray.indexOf(img) + 1;

        // If tweetId is still missing, try to get from page URL (if we are on a status page)
        if (!info.tweetId) {
            const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
            if (urlMatch) info.tweetId = urlMatch[1];
        }

        log('Extracted info:', info);
        return info;
    }

    // ---------- Download Image via GM_xmlhttpRequest ----------
    function downloadImage(img, info) {
        const src = img.currentSrc || img.src;
        if (!src || !src.includes('twimg.com/media')) {
            log('Invalid image source:', src);
            return;
        }

        log('Downloading image:', src);
        log('Tweet info:', info);

        const username = sanitizeFilename(info.username || 'unknown');
        const tweetId = info.tweetId || 'no_id';
        const dateStr = info.date ? formatDate(info.date) : 'no_date';
        const indexStr = info.index ? `_${info.index}` : '';
        const fileExt = src.split('.').pop().split('?')[0].toLowerCase();
        const ext = ['jpg','jpeg','png','gif','webp'].includes(fileExt) ? fileExt : 'jpg';
        const filename = `${username}_${tweetId}_${dateStr}${indexStr}.${ext}`;

        log('Filename:', filename);

        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: src,
                responseType: 'blob',
                onload: function(res) {
                    if (res.status >= 200 && res.status < 300) {
                        const blob = res.response;
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 10000);
                        log('Download triggered successfully.');
                    } else {
                        console.error('GM_xmlhttpRequest failed with status', res.status);
                        alert('Download failed. HTTP status: ' + res.status);
                    }
                },
                onerror: function(err) {
                    console.error('GM_xmlhttpRequest error:', err);
                    alert('Download failed. See console for details.');
                }
            });
        } else {
            fetch(src, { mode: 'cors' })
                .then(res => res.blob())
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                    log('Download triggered via fetch fallback.');
                })
                .catch(err => {
                    console.error('Fetch fallback error:', err);
                    alert('Download failed (fetch). See console for details.');
                });
        }
    }

    // ---------- Add Button to Image ----------
    function addButtonToImage(img) {
        if (img.dataset.twImgSaverProcessed) return;
        img.dataset.twImgSaverProcessed = 'true';

        const container = img.parentElement;
        if (!container) return;

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.textContent = BUTTON_TEXT;
        btn.title = BUTTON_TITLE;
        btn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            width: ${BUTTON_SIZE};
            height: ${BUTTON_SIZE};
            font-size: ${BUTTON_FONT_SIZE};
            line-height: ${BUTTON_SIZE};
            text-align: center;
            background: rgba(0, 0, 0, 0.6);
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            z-index: 9999;
            display: none;
            padding: 0;
        `;

        container.addEventListener('mouseenter', () => { btn.style.display = 'block'; });
        container.addEventListener('mouseleave', () => { btn.style.display = 'none'; });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            const info = getTweetInfo(img);
            if (info) {
                downloadImage(img, info);
            } else {
                alert('Could not extract tweet info. Check console for details.');
            }
        }, true);  // capture

        container.appendChild(btn);
        log('Button added to image:', img.src.slice(0, 80) + '...');
    }

    // ---------- Process Images ----------
    function processImages() {
        const imgs = document.querySelectorAll('img[src*="twimg.com/media"]');
        imgs.forEach(addButtonToImage);
    }

    // ---------- Mutation Observer ----------
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
                shouldProcess = true;
                break;
            }
        }
        if (shouldProcess) processImages();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial processing
    processImages();
    log('Script initialized.');
})();
