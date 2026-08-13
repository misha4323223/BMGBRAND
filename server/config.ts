function envValue(name: string, fallback = ''): string {
  let value = process.env[name]?.trim() ?? fallback;
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1);
    }
  }
  return value;
}

export const config = {
  jwt: {
    secret: (() => {
      const s = envValue('JWT_SECRET');
      if (!s && process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: JWT_SECRET env var must be set in production');
      }
      return s || 'dev-only-local-secret-not-for-production';
    })(),
    expiresIn: '7d',
  },
  app: {
    domain: envValue('APP_DOMAIN', 'https://www.booomerangs.ru'),
    name: 'BOOOMERANGS',
  },
  email: {
    from: envValue('EMAIL_FROM', 'noreply@booomerangs.ru'),
    enabled: !!envValue('SMTP_HOST'),
  },
  smtp: {
    host: envValue('SMTP_HOST'),
    port: parseInt(envValue('SMTP_PORT', '587'), 10),
    user: envValue('SMTP_USER'),
    pass: envValue('SMTP_PASS'),
  },
};
