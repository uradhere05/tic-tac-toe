const { onValueCreated } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

admin.initializeApp();

// Fires when any new message is written to /chat
exports.notifyChat = onValueCreated(
  { ref: '/chat/{msgId}', region: 'us-central1' },
  async (event) => {
    const msg = event.data.val();
    if (!msg || !msg.name || !msg.text) return;

    // Fetch all registered push tokens
    const tokensSnap = await admin.database().ref('/push_tokens').once('value');
    if (!tokensSnap.exists()) return;

    const tokens = [];
    tokensSnap.forEach((child) => {
      const entry = child.val();
      // Don't notify the sender
      if (entry && entry.token && entry.name !== msg.name) {
        tokens.push(entry.token);
      }
    });

    if (!tokens.length) return;

    // Fan-out push to all subscribers except the sender
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: msg.name,
        body: msg.text.length > 100 ? msg.text.slice(0, 97) + '…' : msg.text
      },
      webpush: {
        notification: {
          icon: 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com/icon-192.png',
          badge: 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com/icon-192.png',
          tag: 'arena-chat',
          renotify: true,
          vibrate: [200, 100, 200]
        },
        fcmOptions: { link: 'https://YOUR_DOMAIN/index.html' }
      }
    });

    // Prune tokens that returned errors (expired / unsubscribed)
    const stale = [];
    response.responses.forEach((r, i) => {
      if (!r.success) stale.push(tokens[i]);
    });

    if (stale.length) {
      const updates = {};
      tokensSnap.forEach((child) => {
        if (stale.includes(child.val()?.token)) updates[child.key] = null;
      });
      await admin.database().ref('/push_tokens').update(updates);
    }
  }
);
