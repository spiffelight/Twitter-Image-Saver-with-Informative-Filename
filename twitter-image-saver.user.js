// ==UserScript==
// @name         Twitter Image Saver with Info (Robust)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Download Twitter images and videos with auto-generated filenames. Enhanced tweet info extraction.
// @author       You
// @match        https://twitter.com/*
// @match        https://x.com/*
// @grant        GM_xmlhttpRequest
// @connect      twimg.com
// @connect      video.twimg.com
// @connect      cdn.syndication.twimg.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ---------- Configuration ----------
    const BUTTON_TEXT = '💾';
    const BUTTON_TITLE = 'Download image';
    const BUTTON_SIZE = '28px';
    const BUTTON_FONT_SIZE = '16px';
    const VIDEO_BUTTON_TITLE = 'Download video';
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

    function buildFilename(info, ext) {
        const username = sanitizeFilename(info.username || 'unknown');
        const tweetId = info.tweetId || 'no_id';
        const dateStr = info.date ? formatDate(info.date) : 'no_date';
        const indexStr = info.index ? `_${info.index}` : '';
        return `${username}_${tweetId}_${dateStr}${indexStr}.${ext}`;
    }

    // ---------- Extract Tweet Info (with fallbacks) ----------
    // `el` is the media element (an <img>) or the tweet article itself (videos).
    function getTweetInfo(el) {
        log('getTweetInfo called for:', el.tagName);

        // 1. Standard tweet article
        let tweet = el.closest('article[data-testid="tweet"]');
        if (!tweet) {
            log('No article[data-testid="tweet"] found, trying div fallback.');
            // Sometimes it's a div with the same data-testid
            tweet = el.closest('div[data-testid="tweet"]');
        }

        // 2. If still not found, try to find any ancestor that contains a status link and a time element
        if (!tweet) {
            log('No div fallback, searching for ancestor with /status/ link.');
            let ancestor = el.parentElement;
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
        if (el.tagName === 'IMG') {
            const allMediaImgs = tweet.querySelectorAll('img[src*="twimg.com/media"]');
            info.index = Array.from(allMediaImgs).indexOf(el) + 1;
        } else {
            info.index = 1;
        }

        // If tweetId is still missing, try to get from page URL (if we are on a status page)
        if (!info.tweetId) {
            const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
            if (urlMatch) info.tweetId = urlMatch[1];
        }

        log('Extracted info:', info);
        return info;
    }

    // ---------- Save a URL to disk via GM_xmlhttpRequest ----------
    function saveUrl(src, filename) {
        log('Saving:', src, '->', filename);

        function triggerSave(blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }

        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: src,
                responseType: 'blob',
                onload: function(res) {
                    if (res.status >= 200 && res.status < 300) {
                        triggerSave(res.response);
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
                    triggerSave(blob);
                    log('Download triggered via fetch fallback.');
                })
                .catch(err => {
                    console.error('Fetch fallback error:', err);
                    alert('Download failed (fetch). See console for details.');
                });
        }
    }

    // ---------- Download Image ----------
    function downloadImage(img, info) {
        const src = img.currentSrc || img.src;
        if (!src || !src.includes('twimg.com/media')) {
            log('Invalid image source:', src);
            return;
        }

        const fileExt = src.split('.').pop().split('?')[0].toLowerCase();
        const ext = ['jpg','jpeg','png','gif','webp'].includes(fileExt) ? fileExt : 'jpg';
        saveUrl(src, buildFilename(info, ext));
    }

    // ---------- Download Video ----------
    // The <video> element only holds a streaming (blob/HLS) source, so we look
    // up the tweet's real .mp4 files through Twitter's public embed endpoint.
    function syndicationToken(tweetId) {
        return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    }

    // Pick the highest-bitrate .mp4 from a syndication tweet-result payload.
    function pickBestMp4(data) {
        const media = (data && data.mediaDetails) || [];
        for (const m of media) {
            const variants = (m.video_info && m.video_info.variants) || [];
            const mp4s = variants.filter(v => v.content_type === 'video/mp4' && v.url);
            if (mp4s.length) {
                mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                return mp4s[0].url;
            }
        }
        return null;
    }

    function downloadVideo(info) {
        if (!info.tweetId) {
            alert('Could not determine the tweet ID for this video.');
            return;
        }

        const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${info.tweetId}&token=${syndicationToken(info.tweetId)}&lang=en`;
        log('Looking up video variants:', apiUrl);

        GM_xmlhttpRequest({
            method: 'GET',
            url: apiUrl,
            onload: function(res) {
                let data = null;
                try { data = JSON.parse(res.responseText); } catch (e) { /* not JSON */ }
                const mp4 = pickBestMp4(data);
                if (!mp4) {
                    console.error('[TwImgSaver] No mp4 found. Status:', res.status, data);
                    alert('Could not find a downloadable video for this tweet. Check console for details.');
                    return;
                }
                saveUrl(mp4, buildFilename(info, 'mp4'));
            },
            onerror: function(err) {
                console.error('Video lookup error:', err);
                alert('Video lookup failed. See console for details.');
            }
        });
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

    // ---------- Add Button for Videos ----------
    // Videos get their button in the tweet's action bar (reply / retweet / like /
    // share row) so nothing is ever drawn on top of the video or its controls.
    function addButtonToVideoTweet(article) {
        if (article.dataset.twVidSaverProcessed) return;

        const actionBar = article.querySelector('[data-testid="reply"]')?.closest('div[role="group"]');
        if (!actionBar) return;
        article.dataset.twVidSaverProcessed = 'true';

        const btn = document.createElement('button');
        btn.textContent = BUTTON_TEXT;
        btn.title = VIDEO_BUTTON_TITLE;
        btn.style.cssText = `
            background: none;
            border: none;
            cursor: pointer;
            font-size: ${BUTTON_FONT_SIZE};
            padding: 0 8px;
            color: inherit;
            opacity: 0.75;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.75'; });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            const info = getTweetInfo(article);
            if (info) {
                downloadVideo(info);
            } else {
                alert('Could not extract tweet info. Check console for details.');
            }
        }, true);  // capture

        actionBar.appendChild(btn);
        log('Video button added to tweet action bar.');
    }

    // ---------- Process Media ----------
    function processImages() {
        const imgs = document.querySelectorAll('img[src*="twimg.com/media"]');
        imgs.forEach(addButtonToImage);
    }

    function processVideos() {
        const videos = document.querySelectorAll('article[data-testid="tweet"] video');
        videos.forEach(v => {
            const article = v.closest('article[data-testid="tweet"]');
            if (article) addButtonToVideoTweet(article);
        });
    }

    function processMedia() {
        processImages();
        processVideos();
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
        if (shouldProcess) processMedia();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial processing
    processMedia();
    log('Script initialized.');
})();
