import AfricasTalking from 'africastalking';
import 'dotenv/config';

const AT = AfricasTalking({
  apiKey:   process.env.AT_API_KEY   || '',
  username: process.env.AT_USERNAME  || '',
});

// ─── Send a single SMS ────────────────────────────────────────────────────
export async function sendSMS(phone: string, message: string): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[SMS DEV] To: ${phone}\nMessage: ${message}`);
    return;
  }

  await AT.SMS.send({
    to:      [phone],
    message,
    from:    'FlexSend',
  });
}

// ─── SMS Templates ────────────────────────────────────────────────────────

export function smsWelcomeStaff(params: {
  full_name: string;
  username:  string;
  password:  string;
  role:      string;
}): string {
  return (
    `Welcome to FlexSend, ${params.full_name}!\n` +
    `Your account has been created.\n` +
    `Role: ${params.role.replace(/_/g, ' ')}\n` +
    `Username: ${params.username}\n` +
    `Password: ${params.password}\n` +
    `Login and change your password immediately.`
  );
}

export function smsOTP(otp: string): string {
  return `Your FlexSend verification code is: ${otp}\nValid for 10 minutes. Do not share this code.`;
}

export function smsForgotPassword(otp: string): string {
  return `FlexSend password reset code: ${otp}\nValid for 10 minutes. If you did not request this, ignore.`;
}

export function smsPasswordChanged(): string {
  return `Your FlexSend password has been changed. If this was not you, contact support immediately.`;
}
