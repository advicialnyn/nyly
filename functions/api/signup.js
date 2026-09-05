import { sendTelegramMessage } from '../_lib/telegram.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { username, password } = body;

    // 1. Validate incoming data
    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: 'Username and password are required.' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Process account request (e.g., notify admin via Telegram)
    if (context.env.TELEGRAM_BOT_TOKEN && context.env.TELEGRAM_CHAT_ID) {
      await sendTelegramMessage(context.env, `New account request:\nUsername: ${username}`);
    }

    // 3. Return successful JSON response
    return new Response(
      JSON.stringify({ success: true, message: 'Account request submitted successfully.' }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    // 4. Catch exceptions and return a JSON error payload instead of failing silently
    return new Response(
      JSON.stringify({ error: err.message || 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
