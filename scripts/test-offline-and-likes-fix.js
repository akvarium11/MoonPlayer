const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('[TEST] Starting regression verification for Offline Tracks & SoundCloud Likes...');
    const b = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
    });

    try {
        const p = await b.newPage();
        await p.setViewport({ width: 1400, height: 900 });

        const errs = [];
        p.on('pageerror', e => errs.push(e.message));
        p.on('console', msg => {
            if (msg.type() === 'error') errs.push(msg.text());
        });

        // 1. TEST STARTUP IN RIFF UI: Check Local tracks loading
        await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
        await p.goto('http://localhost:7644', { waitUntil: 'domcontentloaded' });
        console.log('[TEST] Page loaded in Riff mode. Waiting for initial library scan...');
        await sleep(3500);

        const localStatus = await p.evaluate(() => {
            const list = document.getElementById('local-tracks-list');
            const skeleton = list ? list.querySelector('.skeleton-list') : null;
            const rows = list ? list.querySelectorAll('.track-row').length : 0;
            const sub = document.getElementById('local-subtitle')?.textContent;
            const isLoaded = window.isLibraryLoaded;
            const totalSongs = window.MoonPlayer ? window.MoonPlayer.getAllSongs().length : 0;
            return { skeleton: !!skeleton, rows, sub, isLoaded, totalSongs };
        });
        console.log('[TEST] Local View Status:', JSON.stringify(localStatus));

        if (localStatus.skeleton) {
            throw new Error('FAIL: Local view is stuck on skeleton loader (infinite loading)!');
        }
        if (localStatus.rows === 0) {
            throw new Error('FAIL: Local view has 0 rows rendered!');
        }
        console.log('✅ TEST 1 PASS: Offline tracks loaded successfully without infinite loading.');

        // 2. TEST SOUNDCLOUD LIKES VIEW
        console.log('[TEST] Switching to SoundCloud view...');
        await p.evaluate(() => window.RiffUI.switchView('soundcloud'));
        await sleep(1500);

        console.log('[TEST] Clicking "My Likes" subtab...');
        await p.evaluate(() => {
            const btn = document.querySelector('.sc-subtab[data-sctab="likes"]');
            if (btn) btn.click();
        });
        await sleep(3500);

        const likesStatus = await p.evaluate(() => {
            const list = document.getElementById('sc-tracks-list');
            const rows = list ? Array.from(list.querySelectorAll('.track-row')) : [];
            const sub = document.getElementById('sc-subtitle')?.textContent;
            const hearts = rows.map(r => {
                const favBtn = r.querySelector('.btn-row-fav');
                const svg = favBtn ? favBtn.querySelector('svg') : null;
                return svg ? svg.getAttribute('fill') : null;
            });
            const firstRowTitle = rows[0]?.querySelector('.track-row-title')?.textContent;
            const firstTrackLiked = rows[0] && rows[0]._track ? window.MoonPlayer.isLiked(rows[0]._track) : null;
            const dummyLiked = window.MoonPlayer.isLiked({ id: '999999999999', path: 'fake_song_xyz' });
            return {
                rowCount: rows.length,
                sub,
                firstRowTitle,
                firstTrackLiked,
                dummyLiked,
                activeHeartsCount: hearts.filter(f => f === 'currentColor').length,
                emptyHeartsCount: hearts.filter(f => f === 'none').length
            };
        });
        console.log('[TEST] SoundCloud Likes Status:', JSON.stringify(likesStatus));

        if (likesStatus.rowCount === 0) {
            throw new Error('FAIL: SoundCloud Likes list is empty!');
        }
        if (likesStatus.dummyLiked !== false) {
            throw new Error('FAIL: isLiked incorrectly returns true for unliked/dummy tracks!');
        }
        if (likesStatus.activeHeartsCount === 0) {
            throw new Error('FAIL: No active (filled) hearts in SoundCloud Likes list!');
        }
        console.log('✅ TEST 2 PASS: SoundCloud likes rendered with filled heart icons and accurate isLiked check.');

        // 3. TEST TOGGLING LIKE ON A TRACK
        console.log('[TEST] Testing like toggle on track...');
        const toggleResult = await p.evaluate(async () => {
            const firstRow = document.querySelector('#sc-tracks-list .track-row');
            if (!firstRow || !firstRow._track) return { success: false, reason: 'no row' };
            const track = firstRow._track;
            const initialFav = window.MoonPlayer.isLiked(track);
            // Click favorite button on first row
            const favBtn = firstRow.querySelector('.btn-row-fav');
            favBtn.click();
            await new Promise(r => setTimeout(r, 600));
            const afterFirstToggleFav = window.MoonPlayer.isLiked(track);
            const firstFill = favBtn.querySelector('svg')?.getAttribute('fill');

            // Click again to toggle back
            favBtn.click();
            await new Promise(r => setTimeout(r, 600));
            const afterSecondToggleFav = window.MoonPlayer.isLiked(track);
            const secondFill = favBtn.querySelector('svg')?.getAttribute('fill');

            return {
                initialFav,
                afterFirstToggleFav,
                firstFill,
                afterSecondToggleFav,
                secondFill
            };
        });
        console.log('[TEST] Like Toggle Result:', JSON.stringify(toggleResult));

        if (toggleResult.initialFav === toggleResult.afterFirstToggleFav) {
            throw new Error('FAIL: Clicking like button did not toggle the liked state!');
        }
        if (toggleResult.initialFav !== toggleResult.afterSecondToggleFav) {
            throw new Error('FAIL: Clicking like button second time did not restore liked state!');
        }
        console.log('✅ TEST 3 PASS: Interactive like toggle works reactively.');

        // 4. TEST PLAYBACK OF OFFLINE TRACK
        console.log('[TEST] Testing offline track playback...');
        await p.evaluate(() => window.RiffUI.switchView('local'));
        await sleep(1000);
        const playOffline = await p.evaluate(async () => {
            const firstRow = document.querySelector('#local-tracks-list .track-row');
            if (!firstRow) return { ok: false, reason: 'no local row' };
            firstRow.click();
            const a = document.getElementById('bg-audio');
            const t0 = Date.now();
            while (Date.now() - t0 < 6000) {
                await new Promise(r => setTimeout(r, 300));
                if (a.readyState >= 2 && !a.paused && a.currentTime > 0.05) break;
            }
            return {
                title: window.MoonPlayer.getCurrentSong()?.title,
                paused: a.paused,
                currentTime: a.currentTime
            };
        });
        console.log('[TEST] Offline Track Playback:', JSON.stringify(playOffline));
        if (playOffline.paused || playOffline.currentTime <= 0) {
            throw new Error('FAIL: Offline track failed to play!');
        }
        console.log('✅ TEST 4 PASS: Offline track plays cleanly.');

        console.log('[TEST] ALL TESTS PASSED!');
        if (errs.length > 0) {
            console.log('[TEST] Page errors noted:', JSON.stringify(errs));
        }
        process.exit(0);
    } catch (e) {
        console.error('[TEST ERROR]', e);
        process.exit(1);
    } finally {
        await b.close();
    }
})();
