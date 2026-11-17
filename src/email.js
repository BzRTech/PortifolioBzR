// Envio de e-mail (código de acesso do Portal do Cidadão).
// SMTP_URL=smtps://usuario:senha@smtp.servidor.gov.br:465  ·  SMTP_FROM="Prefeitura <nao-responda@…>"
// Sem SMTP_URL o envio não está disponível (fora de produção o portal mostra o
// código na tela, só para demonstração).
import nodemailer from 'nodemailer';

let transporte = null;
export const emailConfigurado = () => Boolean(process.env.SMTP_URL);

export async function enviarEmail({ para, assunto, texto, html }) {
  if (!emailConfigurado()) throw new Error('SMTP_URL não configurado.');
  if (!transporte) transporte = nodemailer.createTransport(process.env.SMTP_URL);
  await transporte.sendMail({ from: process.env.SMTP_FROM || 'nao-responda@localhost', to: para, subject: assunto, text: texto, html });
}

/** f***@g***.com — para mostrar ao cidadão para onde o código foi. */
export function mascararEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!u || !d) return '';
  const [dom, ...resto] = d.split('.');
  return `${u[0]}***@${dom[0]}***.${resto.join('.') || ''}`.replace(/\.$/, '');
}
