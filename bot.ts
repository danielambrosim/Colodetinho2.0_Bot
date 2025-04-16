import TelegramBot from 'node-telegram-bot-api';
import { sendVerificationEmail } from './mail';
import pool from './db';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true });

// Cria a pasta uploads se não existir
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

enum State {
  NONE,
  NOME,
  EMAIL,
  EMAIL_VERIFICACAO,
  DOCUMENT_TYPE,
  CPF,
  CNPJ,
  DOCUMENT_UPLOAD,
  SENHA,
  ADD_CNPJ_LATER,  // Nova etapa para adicionar CNPJ posteriormente
}

interface UserData {
  nome?: string;
  email?: string;
  documentType?: string;
  cpf?: string;
  cnpj?: string;
  senha?: string;
  codigoConfirmacao?: number;
  documentValidated?: boolean;
  documentPath?: string;
}

const userStates: Record<number, State> = {};
const userData: Record<number, UserData> = {};

// Função para limpar arquivos antigos
function cleanupOldFiles() {
  const dir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000; // 1 dia em milissegundos

  files.forEach(file => {
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtime.getTime() > oneDay) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`Erro ao limpar arquivo ${filePath}:`, error);
    }
  });
}

// Agendando limpeza diária
setInterval(cleanupOldFiles, 24 * 60 * 60 * 1000);
cleanupOldFiles(); // Executa imediatamente ao iniciar

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  if (!userStates[chatId]) userStates[chatId] = State.NONE;
  if (!userData[chatId]) userData[chatId] = {};

  try {
    switch (userStates[chatId]) {
      case State.NONE:
        await bot.sendMessage(chatId, 'Bem-vindo ao cadastro! Qual é o seu nome?');
        userStates[chatId] = State.NOME;
        break;

      case State.NOME:
        userData[chatId].nome = text;
        await bot.sendMessage(chatId, 'Por favor, informe o seu e-mail:');
        userStates[chatId] = State.EMAIL;
        break;

      case State.EMAIL:
        if (isValidEmail(text)) {
          userData[chatId].email = text;
          userData[chatId].codigoConfirmacao = Math.floor(100000 + Math.random() * 900000);
          await sendVerificationEmail(text, userData[chatId].codigoConfirmacao!);
          await bot.sendMessage(chatId, 'Código de confirmação enviado para o seu e-mail. Por favor, digite o código recebido:');
          userStates[chatId] = State.EMAIL_VERIFICACAO;
        } else {
          await bot.sendMessage(chatId, 'E-mail inválido. Tente novamente.');
        }
        break;

      case State.EMAIL_VERIFICACAO:
        if (parseInt(text) === userData[chatId].codigoConfirmacao) {
          await bot.sendMessage(chatId, 'E-mail confirmado! Você deseja cadastrar como CPF ou CNPJ? Responda com "CPF" ou "CNPJ":');
          userStates[chatId] = State.DOCUMENT_TYPE;
        } else {
          await bot.sendMessage(chatId, 'Código incorreto. Por favor, tente novamente.');
        }
        break;

      case State.DOCUMENT_TYPE:
        if (text.toUpperCase() === 'CPF' || text.toUpperCase() === 'CNPJ') {
          userData[chatId].documentType = text.toUpperCase();
          await bot.sendMessage(chatId, `Informe o seu ${text.toUpperCase()} (apenas números):`);
          userStates[chatId] = text.toUpperCase() === 'CPF' ? State.CPF : State.CNPJ;
        } else {
          await bot.sendMessage(chatId, 'Opção inválida. Por favor, responda com "CPF" ou "CNPJ":');
        }
        break;

      case State.CPF:
        if (isValidCPF(text)) {
          userData[chatId].cpf = text;
          await bot.sendMessage(chatId, 'CPF válido! Agora, envie uma foto ou imagem do seu documento para validação:');
          userStates[chatId] = State.DOCUMENT_UPLOAD;
        } else {
          await bot.sendMessage(chatId, 'CPF inválido. Por favor, digite um CPF válido (apenas números):');
        }
        break;

      case State.CNPJ:
        if (isValidCNPJ(text)) {
          userData[chatId].cnpj = text;
          await bot.sendMessage(chatId, 'CNPJ válido! Agora, envie uma foto ou imagem do seu documento para validação:');
          userStates[chatId] = State.DOCUMENT_UPLOAD;
        } else {
          await bot.sendMessage(chatId, 'CNPJ inválido. Por favor, digite um CNPJ válido (apenas números):');
        }
        break;

      case State.DOCUMENT_UPLOAD:
        await bot.sendMessage(chatId, 'Documento recebido! Agora, você deseja adicionar um CNPJ ao seu cadastro? Responda com "sim" para adicionar ou "não" para finalizar:');
        userStates[chatId] = State.ADD_CNPJ_LATER;
        break;

      case State.ADD_CNPJ_LATER:
        if (text.toLowerCase() === 'sim') {
          await bot.sendMessage(chatId, 'Agora, por favor, informe o seu CNPJ (apenas números):');
          userStates[chatId] = State.CNPJ;
        } else if (text.toLowerCase() === 'não') {
          await bot.sendMessage(chatId, 'Cadastro concluído! Obrigado por se cadastrar.');
          // Aqui você pode salvar os dados do usuário no banco de dados
          resetUser(chatId);
        } else {
          await bot.sendMessage(chatId, 'Opção inválida. Por favor, responda com "sim" ou "não":');
        }
        break;

      case State.SENHA:
        userData[chatId].senha = await bcrypt.hash(text, 10);
        await saveToDatabase(
          userData[chatId].nome!,
          userData[chatId].email!,
          userData[chatId].cpf,
          userData[chatId].cnpj,
          userData[chatId].senha,
          userData[chatId].documentPath,
          userData[chatId].documentValidated
        );
        await bot.sendMessage(chatId, 'Cadastro realizado com sucesso!');
        resetUser(chatId);
        break;
    }
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, 'Ocorreu um erro. Tente novamente.');
    resetUser(chatId);
  }
});

async function validateDocument(filePath: string): Promise<boolean> {
  // Em produção, implemente validação real do documento
  // Aqui estamos apenas simulando uma validação bem-sucedida
  return new Promise(resolve => setTimeout(() => resolve(true), 1000));
}

function resetUser(chatId: number) {
  delete userStates[chatId];
  delete userData[chatId];
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidCPF(cpf: string): boolean {
  cpf = cpf.replace(/[^\d]+/g, '');
  if (cpf.length !== 11 || !!cpf.match(/(\d)\1{10}/)) return false;
  
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let resto = 11 - (soma % 11);
  let digito1 = resto >= 10 ? 0 : resto;
  
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf.charAt(i)) * (11 - i);
  }
  resto = 11 - (soma % 11);
  let digito2 = resto >= 10 ? 0 : resto;
  
  return digito1 === parseInt(cpf.charAt(9)) && digito2 === parseInt(cpf.charAt(10));
}

function isValidCNPJ(cnpj: string): boolean {
  cnpj = cnpj.replace(/[^\d]+/g, '');
  if (cnpj.length !== 14) return false;
  
  let soma = 0;
  let pos = cnpj.length - 7;
  for (let i = 0; i < 12; i++) {
    soma += parseInt(cnpj.charAt(i)) * (pos--);
    if (pos < 2) pos = 9;
  }
  let resto = soma % 11;
  let digito1 = resto < 2 ? 0 : 11 - resto;
  soma = 0;
  pos = cnpj.length - 8;
  for (let i = 0; i < 13; i++) {
    soma += parseInt(cnpj.charAt(i)) * (pos--);
    if (pos < 2) pos = 9;
  }
  resto = soma % 11;
  let digito2 = resto < 2 ? 0 : 11 - resto;
  
  return digito1 === parseInt(cnpj.charAt(12)) && digito2 === parseInt(cnpj.charAt(13));
}

async function saveToDatabase(nome: string, email: string, cpf?: string, cnpj?: string, senha?: string, documentPath?: string, documentValidated?: boolean) {
  // Função para salvar os dados no banco de dados
  try {
    const client = await pool.connect();
    await client.query('INSERT INTO usuarios(nome, email, cpf, cnpj, senha, document_path, document_validated) VALUES($1, $2, $3, $4, $5, $6, $7)', [nome, email, cpf, cnpj, senha, documentPath, documentValidated]);
    client.release();
  } catch (err) {
    console.error('Erro ao salvar no banco de dados:', err);
  }
}
