// js/online.js
(function() {
    function updateOnlineList() {
        fetch('/api/online-users')
            .then(res => res.json())
            .then(users => {
                const container = document.getElementById('online-list');
                if (!container) return;

                if (users.length === 0) {
                    container.innerHTML = '<li>ユーザーデータがありません</li>';
                    return;
                }

                container.innerHTML = users.map(user => {
                    const fallbackName = user.displayName || user.username;
                    const initialLetter = fallbackName ? fallbackName.charAt(0).toUpperCase() : '?';
                    
                    const charIconStyle = `display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; background: #e0f2fe; color: #0369a1; font-weight: 700; font-size: 14px; vertical-align: middle; margin-right: 4px;`;
                    const imgStyle = `width: 34px; height: 34px; border-radius: 50%; margin-right: 4px; object-fit: cover; vertical-align: middle;`;

                    let iconHTML = '';
                    if (user.icon && user.icon.trim() !== '') {
                        iconHTML = `
                            <img src="${user.icon}" style="${imgStyle}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';">
                            <div class="icon-circle" style="${charIconStyle} display: none;">${initialLetter}</div>
                        `;
                    } else {
                        iconHTML = `<div class="icon-circle" style="${charIconStyle}">${initialLetter}</div>`;
                    }
                    
                    const isOnline = user.status === 'online';
                    let statusBadge = '';
                    let pageInfoHTML = '';

                    if (isOnline) {
                        statusBadge = `<span style="margin-left: auto; font-size: 12px; color: #10b981; font-weight: bold; background: #e6f4ea; padding: 2px 8px; border-radius: 12px;">● オンライン</span>`;
                        const currentPage = user.currentPage ? user.currentPage : 'メインページなど';
                        pageInfoHTML = `<span style="font-size: 11px; color: #0284c7; background: #f0f9ff; padding: 1px 6px; border-radius: 4px; margin-top: 4px; width: fit-content;">💻 表示中: ${currentPage}</span>`;
                    } else {
                        statusBadge = `<span style="margin-left: auto; font-size: 12px; color: #9ca3af; font-weight: bold; background: #f3f4f6; padding: 2px 8px; border-radius: 12px;">○ オフライン</span>`;
                    }

                    return `
                        <li style="display: flex; align-items: center; margin-bottom: 10px; padding: 8px; border-bottom: 1px solid #f3f4f6;">
                            <div style="display: inline-flex; align-items: center; justify-content: center;">
                                ${iconHTML}
                            </div>
                            <div style="display: inline-flex; flex-direction: column; vertical-align: middle; margin-left: 4px;">
                                <strong style="font-size: 14px; color: #1f2937;">${fallbackName}</strong>
                                <span style="font-size: 12px; color: #6b7280;">@${user.username}</span>
                                ${pageInfoHTML}
                            </div>
                            ${statusBadge}
                        </li>
                    `;
                }).join('');
            })
            .catch(err => console.error('Failed to fetch online users:', err));
    }

    updateOnlineList();
    setInterval(updateOnlineList, 10000);
})();