import 'server-only';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import net from 'node:net';
import { resolvePublicAddress } from '../site-audit';
import { normalizeSmtpConfiguration, type SmtpConfiguration } from './email-configuration';

type TestTransport = { verify(): Promise<unknown>; close(): void };
const createTransport = (options: SMTPTransport.Options): TestTransport => nodemailer.createTransport(options);
export const connectPinnedSmtp = (address: string, port: number): Promise<net.Socket> => new Promise((resolve, reject) => {
  const socket = net.connect({ host: address, port });
  socket.setTimeout(4000, () => socket.destroy(new Error('SMTP connection timeout.')));
  socket.once('error', reject);
  socket.once('connect', () => { socket.setTimeout(0); resolve(socket); });
});
async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('SMTP timeout.')), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export function smtpTransportOptions(settings:SmtpConfiguration,address:string,socket:net.Socket,password:string):SMTPTransport.Options{
  return {host:address,connection:socket,port:settings.port,secure:settings.port===465,requireTLS:true,opportunisticTLS:false,ignoreTLS:false,pool:false,forceAuth:true,auth:{user:settings.user,pass:password},name:'marketing-platform',tls:{servername:settings.host,rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:8000,greetingTimeout:5000,socketTimeout:12000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true};
}
export async function verifySmtpConnection(raw: SmtpConfiguration, password: string, resolve = resolvePublicAddress, create = createTransport, connect = connectPinnedSmtp) {
  let transport: TestTransport | undefined;
  let socket: net.Socket | undefined;
  try {
    const settings = normalizeSmtpConfiguration(raw);
    if (typeof password !== 'string' || !password || password.length > 16384 || /[\r\n\x00]/.test(password)) throw new Error();
    // Reuse audit's private-network checks; connect to the validated IP, never resolve again.
    const pinned = await bounded(resolve(new URL(`https://${settings.host}/`)), 4000);
    socket = await connect(pinned.address, settings.port);
    transport = create(smtpTransportOptions(settings,pinned.address,socket,password));
    if (await bounded(transport.verify(), 12000) !== true) throw new Error('SMTP verification failed.');
    return { status: 'verified' as const, message: 'SMTP TLS ve hesap erişimi doğrulandı. Gönderen alan adı ve teslimat henüz doğrulanmadı.' };
  } catch { return { status: 'failed' as const, message: 'SMTP erişimi doğrulanamadı. Sunucu, TLS, hesap bilgileri ve ağ izinlerini kontrol edin.' }; }
  finally { socket?.destroy(); transport?.close(); }
}
