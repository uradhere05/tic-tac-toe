const { onValueCreated } = require('firebase-functions/v2/database');
const admin   = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();

const VAPID_PUBLIC  = 'BDkO2jrQb2hbZ8HiBJByJKeu8BSrT29cOUcI1svt3akFncLo0XGjpo3hJUJaFwDGZfhmmvhxWTeAHMASdk44qqk';
const VAPID_PRIVATE = 'V0HY6trH9rKWAuGjFjbfLqB8SBbFOgo9ePH0mQ4kz6I';
const VAPID_EMAIL   = 'mailto:uradhere05@gmail.com';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

exports.notifyChat = onValueCreated(
  { ref: '/chat/{msgId}', region: 'us-central1' },
  async (event) => {
    const msg = event.data.val();
    if (!msg || !msg.name || !msg.text) return;

    const subsSnap = await admin.database().ref('/push_subs').once('value');
    if (!subsSnap.exists()) return;

    const payload = JSON.stringify({
      title: msg.name,
      body:  msg.text.length > 100 ? msg.text.slice(0, 97) + '…' : msg.text
    });

    const staleKeys = [];

    console.log(`[notifyChat] sender="${msg.name}" subs=${JSON.stringify(Object.keys(subsSnap.val() || {}))}`);

    await Promise.all(
      Object.entries(subsSnap.val() || {}).map(async ([key, entry]) => {
        if (!entry || !entry.sub) { console.log(`[notifyChat] skip ${key}: no entry/sub`); return; }
        if (entry.name === msg.name) { console.log(`[notifyChat] skip ${key}: is sender`); return; }
        console.log(`[notifyChat] sending to ${key} (entry.name="${entry.name}")`);
        try {
          const sub = JSON.parse(entry.sub);
          await webpush.sendNotification(sub, payload);
        } catch (e) {
          console.log(`[notifyChat] push failed for ${key}: ${e.statusCode}`);
          if (e.statusCode === 410 || e.statusCode === 404) staleKeys.push(key);
        }
      })
    );

    if (staleKeys.length) {
      const updates = Object.fromEntries(staleKeys.map(k => [k, null]));
      await admin.database().ref('/push_subs').update(updates);
    }
  }
);
