const Flux = require("Flux");
const ChannelStore = require("ChannelStore");
const UserStore = require("UserStore");
const Toast = require("Toast");

let schedules = JSON.parse(
    require("Storage").get("msgScheduler", "[]")
);
let timers = {};

function save() {
    require("Storage").set("msgScheduler", JSON.stringify(schedules));
}

function parseTime(str) {
    str = str.trim().toLowerCase();
    // "30m", "1h", "2d", "45s", "1h30m"
    let ms = 0;
    const re = /(\d+)([smhd])/g;
    let m, found = false;
    while ((m = re.exec(str)) !== null) {
        found = true;
        const n = parseInt(m[1]);
        ms += n * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]];
    }
    if (!found || ms <= 0) return null;
    return ms;
}

function send(channelId, content) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;
    Flux.dispatch({
        type: "MESSAGE_CREATE",
        channelId,
        message: {
            id: Date.now().toString(36),
            channelId,
            author: { id: userId },
            content,
            timestamp: new Date().toISOString(),
        },
    });
    Toast.show({ content: "✅ Sent: " + content.slice(0, 40), duration: 3000 });
}

function fire(entry) {
    clearTimeout(timers[entry.id]);
    delete timers[entry.id];
    send(entry.channelId, entry.content);
    schedules = schedules.filter(s => s.id !== entry.id);
    save();
}

function startTimer(entry) {
    const remaining = entry.sendAt - Date.now();
    if (remaining <= 0) { fire(entry); return; }
    timers[entry.id] = setTimeout(() => fire(entry), remaining);
}

module.exports = {
    onLoad() {
        const now = Date.now();
        for (const e of schedules) {
            if (e.sendAt > now) startTimer(e);
            else fire(e);
        }

        require("Commands").register({
            name: "schedule",
            call: (args) => {
                if (args.length < 2) {
                    Toast.show({ content: "Usage: /schedule 30m your message" });
                    return;
                }
                const ms = parseTime(args[0]);
                if (!ms) {
                    Toast.show({ content: "Bad time. Try: 30m, 1h, 2d, 1h30m" });
                    return;
                }
                const content = args.slice(1).join(" ");
                const ch = ChannelStore.getSelectedChannel?.();
                if (!ch) {
                    Toast.show({ content: "No channel selected" });
                    return;
                }
                const entry = {
                    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                    channelId: ch.id,
                    content,
                    sendAt: Date.now() + ms,
                };
                schedules.push(entry);
                save();
                startTimer(entry);
                const mins = Math.round(ms / 6e4);
                Toast.show({ content: `⏰ Scheduled in ~${mins}m` });
            },
        });

        require("Commands").register({
            name: "schedlist",
            call: () => {
                if (!schedules.length) {
                    Toast.show({ content: "Nothing scheduled" });
                    return;
                }
                const txt = schedules.map(s =>
                    `[${s.id.slice(0,6)}] ${Math.round((s.sendAt - Date.now())/6e4)}m: ${s.content.slice(0,25)}`
                ).join("\n");
                Toast.show({ content: txt, duration: 5000 });
            },
        });

        require("Commands").register({
            name: "schedcancel",
            call: (args) => {
                if (!args[0]) {
                    Toast.show({ content: "Usage: /schedcancel <id>" });
                    return;
                }
                const e = schedules.find(s => s.id.startsWith(args[0]));
                if (!e) {
                    Toast.show({ content: "Not found. /schedlist" });
                    return;
                }
                clearTimeout(timers[e.id]);
                delete timers[e.id];
                schedules = schedules.filter(s => s.id !== e.id);
                save();
                Toast.show({ content: "Cancelled" });
            },
        });
    },

    onUnload() {
        for (const id of Object.keys(timers)) clearTimeout(timers[id]);
        timers = {};
    },
};   
