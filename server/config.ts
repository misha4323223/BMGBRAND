export const config = {
  jwt: {
    secret: process.env.JWT_SECRET || 'bmgbrand-jwt-secret-change-in-production',
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
