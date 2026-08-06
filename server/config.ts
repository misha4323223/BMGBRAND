export const config = {
  jwt: {
    secret: (() => {
      const s = process.env.JWT_SECRET;
      if (!s && process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: JWT_SECRET env var must be set in production');
      }
      return s || 'dev-only-local-secret-not-for-production';
    })(),
    expiresIn: '7d',
  },
  app: {
    domain: process.env.APP_DOMAIN || 'https://www.booomerangs.ru',
    name: 'BOOOMERANGS',
  },
  email: {
    from: process.env.EMAIL_FROM || 'noreply@booomerangs.ru',
    enabled: !!process.env.SMTP_HOST,
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};
