import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendVerificationEmail = (to: string, code: number) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject: 'Código de Confirmação',
    text: `Seu código de confirmação é: ${code}`,
  };
  return transporter.sendMail(mailOptions);
};
