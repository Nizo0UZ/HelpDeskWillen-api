import { fakerPT_BR as faker } from '@faker-js/faker';
import bcrypt from 'bcrypt';
import { elasticClient } from './config/elastic';
import {
  PapelUsuario,
  PrioridadeChamado,
  prisma,
  StatusChamado,
} from './config/prisma';
import { sincronizarTodosChamadosBulk } from './services/buscaService';
import {
  encerrar as encerrarEmbeddings,
  reindexarBaseSemantica,
  type ResumoReindexacao,
} from './services/embeddingService';

export interface ResumoSeed {
  categorias: number;
  tags: number;
  usuarios: number;
  artigos: number;
  chamados: number;
  chamadosRealistas: number;
  comentarios: number;
  chamadoTags: number;
  embeddings: ResumoReindexacao | null;
}

interface CategoriaSeed {
  nome: string;
  descricao: string;
}

interface ChamadoRealistaSeed {
  titulo: string;
  descricao: string;
  solucao: string;
  categoriaNome: string;
  prioridade: PrioridadeChamado;
  tags: string[];
  comentarioSolicitante: string;
  comentarioAtendente: string;
}

interface ArtigoRealistaSeed {
  titulo: string;
  conteudo: string;
  categoriaNome: string;
}

const TOTAL_USUARIOS = 50;
const TOTAL_CHAMADOS = 5000;
const TAMANHO_LOTE_INSERT = 1000;
const BCRYPT_SALT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// 1. Categorias (~10 categorias de TI)
// ---------------------------------------------------------------------------
const CATEGORIAS_TI: readonly CategoriaSeed[] = [
  {
    nome: 'Rede e Conectividade',
    descricao: 'Problemas de Wi-Fi, cabeamento estruturado, DNS, DHCP e switches.',
  },
  {
    nome: 'Acesso e Autenticação',
    descricao: 'Reset de senha, bloqueio no Active Directory, SSO e autenticação multifator (MFA/2FA).',
  },
  {
    nome: 'VPN e Acesso Remoto',
    descricao: 'Falhas em túneis VPN corporativos (FortiClient, OpenVPN), RDP e certificados.',
  },
  {
    nome: 'Hardware e Periféricos',
    descricao: 'Notebooks, desktops, monitores, teclados, headsets, baterias e substituição de SSD/RAM.',
  },
  {
    nome: 'Software e Aplicativos',
    descricao: 'Instalação, licenciamento, travamentos do pacote Office, navegadores e ferramentas.',
  },
  {
    nome: 'E-mail e Colaboração',
    descricao: 'Microsoft Outlook, Exchange, Teams, listas de distribuição, caixas compartilhadas e arquivos OST.',
  },
  {
    nome: 'Impressoras e Digitalização',
    descricao: 'Fila de impressão travada (spooler), mapeamento de impressoras de rede, toner e scanners.',
  },
  {
    nome: 'Sistemas Internos (ERP/CRM)',
    descricao: 'Erros de permissão, emissão de nota fiscal, integrações e módulos do ERP e CRM.',
  },
  {
    nome: 'Banco de Dados e Servidores',
    descricao: 'Lentidão em consultas SQL, conexões esgotadas, rotinas de backup e containers Docker.',
  },
  {
    nome: 'Segurança da Informação',
    descricao: 'Alertas de antivírus/EDR, phishing, bloqueio de firewall, certificados SSL e criptografia BitLocker.',
  },
];

// ---------------------------------------------------------------------------
// 2. Tags (20 tags técnicas para relação N:N)
// ---------------------------------------------------------------------------
const TAGS_TI: readonly string[] = [
  'vpn',
  'senha',
  'active-directory',
  'mfa',
  'wifi',
  'dns',
  'impressora',
  'spooler',
  'outlook',
  'teams',
  'hardware',
  'bsod',
  'ssd',
  'erp',
  'nota-fiscal',
  'banco-de-dados',
  'postgresql',
  'backup',
  'ssl',
  'bitlocker',
];

// ---------------------------------------------------------------------------
// 3. Artigos da Base de Conhecimento (20 artigos completos escritos à mão)
// ---------------------------------------------------------------------------
const ARTIGOS_BASE_CONHECIMENTO: readonly ArtigoRealistaSeed[] = [
  {
    titulo: 'Procedimento para desbloqueio de conta e reset de senha no Active Directory',
    categoriaNome: 'Acesso e Autenticação',
    conteudo:
      'Quando um colaborador erra a senha corporativa 5 vezes consecutivas, a política de GPO bloqueia a conta por 30 minutos. Para desbloquear imediatamente: 1) Acesse o console Active Directory Users and Computers (dsa.msc); 2) Localize o usuário pela matrícula ou e-mail; 3) Na aba Account, marque a opção "Unlock account"; 4) Caso seja necessário redefinir a senha, clique com o botão direito em Reset Password, defina uma senha temporária padrão e marque "User must change password at next logon". Oriente o usuário a atualizar também a senha salva no Gerenciador de Credenciais do Windows para evitar novos bloqueios automáticos.',
  },
  {
    titulo: 'Como reconfigurar o autenticador MFA (Microsoft Authenticator) após troca de celular',
    categoriaNome: 'Acesso e Autenticação',
    conteudo:
      'Se o colaborador trocou de aparelho celular e perdeu o acesso ao Microsoft Authenticator: 1) Confirme a identidade do solicitante por chamada de vídeo; 2) Acesse o Microsoft Entra Admin Center > Users > Authentication methods; 3) Clique em "Require re-register multifactor authentication"; 4) Peça para o usuário acessar https://aka.ms/mfasetup pelo computador e escanear o novo QR Code no aplicativo do celular novo.',
  },
  {
    titulo: 'Solução para erro de conexão VPN FortiClient travando em 40% ou 98%',
    categoriaNome: 'VPN e Acesso Remoto',
    conteudo:
      'Quando o FortiClient VPN interrompe a conexão em 40% (erro de certificado TLS) ou 98% (falha na interface virtual PPP/TAP): 1) Para erro em 40%, abra Opções da Internet > Avançadas e habilite TLS 1.2 e TLS 1.3, além de importar o certificado raiz da autoridade interna na pasta Autoridades de Certificação Raiz Confiáveis; 2) Para travamento em 98%, abra o Gerenciador de Dispositivos > Adaptadores de Rede, desinstale o adaptador virtual FortiSSL e reinicie o serviço FortiClient Service Scheduler.',
  },
  {
    titulo: 'Diagnóstico e correção de problemas de Wi-Fi corporativo (Sem Internet / IP 169.254.x.x)',
    categoriaNome: 'Rede e Conectividade',
    conteudo:
      'Endereços IP iniciados em 169.254.x.x (APIPA) indicam que a estação não recebeu resposta do servidor DHCP. Execute no Prompt de Comando como Administrador: ipconfig /release, seguido de ipconfig /renew e ipconfig /flushdns. Caso persista, redefina a pilha Winsock com "netsh winsock reset" e "netsh int ip reset", reiniciando o notebook em seguida. Verifique também se o certificado 802.1X da máquina não expirou.',
  },
  {
    titulo: 'Como limpar a fila de impressão travada (Spooler) no Windows 10 e 11',
    categoriaNome: 'Impressoras e Digitalização',
    conteudo:
      'Se documentos ficam presos com status "Imprimindo" ou "Excluindo" indefinidamente: 1) Abra o Prompt de Comando como Administrador; 2) Pare o serviço com "net stop spooler"; 3) Apague todos os arquivos temporários em C:\\Windows\\System32\\spool\\PRINTERS\\ ("del /Q /F /S %systemroot%\\System32\\Spool\\Printers\\*.*"); 4) Inicie o serviço novamente com "net start spooler". Se a impressora for de rede, confira se a porta TCP/IP utiliza protocolo RAW (porta 9100) com SNMP desabilitado.',
  },
  {
    titulo: 'Reparo de arquivo de dados corrompido (.OST / .PST) no Microsoft Outlook',
    categoriaNome: 'E-mail e Colaboração',
    conteudo:
      'Quando o Outlook apresenta a mensagem "Não é possível expandir a pasta" ou congela ao sincronizar caixas grandes: 1) Feche completamente o Outlook; 2) Navegue até %localappdata%\\Microsoft\\Outlook; 3) Renomeie o arquivo .ost do usuário para .ost.bak; 4) Abra o Outlook novamente para que o Exchange recrie o cache local limpo. Para arquivos .pst locais, execute o utilitário SCANPST.EXE localizado na pasta de instalação do Office.',
  },
  {
    titulo: 'Recuperação de chave BitLocker quando o notebook pede tela azul de recuperação no boot',
    categoriaNome: 'Segurança da Informação',
    conteudo:
      'A tela de recuperação do BitLocker costuma ser acionada após atualizações de BIOS/UEFI ou alterações no módulo TPM 2.0. Para recuperar o acesso: 1) Anote os 8 primeiros dígitos do ID da Chave exibido na tela do usuário; 2) Consulte o atributo msFVE-RecoveryPassword do computador no Active Directory ou no portal Intune/Entra ID; 3) Digite a chave de recuperação de 48 dígitos; 4) Após iniciar o Windows, suspenda a proteção por 1 reinicialização ("manage-bde -protectors -disable C: -rc 1") e atualize o firmware.',
  },
  {
    titulo: 'Resolução de erro de rejeição SEFAZ e certificado digital A1 expirado no ERP',
    categoriaNome: 'Sistemas Internos (ERP/CRM)',
    conteudo:
      'Caso o módulo de faturamento do ERP retorne erro de comunicação SSL ou "Certificado Digital vencido/inválido" ao emitir NF-e: 1) Acesse o servidor de aplicação do ERP; 2) Substitua o arquivo .pfx do certificado A1 vigente no cofre de certificados do sistema; 3) Atualize a senha do certificado nos parâmetros fiscais da filial; 4) Reinicie o serviço de mensageria fiscal e retransmita as notas em contingência.',
  },
  {
    titulo: 'Como liberar espaço em disco quando o WSL2 / Docker Desktop consome toda a unidade C:',
    categoriaNome: 'Banco de Dados e Servidores',
    conteudo:
      'O arquivo virtual ext4.vhdx do Docker Desktop no WSL2 cresce dinamicamente mas não devolve espaço automaticamente ao Windows. Para compactar: 1) Execute "docker system prune -a --volumes" para remover imagens e volumes órfãos; 2) Encerre o WSL com "wsl --shutdown"; 3) No PowerShell como Administrador, execute diskpart, selecione o arquivo ext4.vhdx ("select vdisk file=...") e rode "compact vdisk". Configure também o limite de memória e swap no arquivo .wslconfig.',
  },
  {
    titulo: 'Correção de microfone ou câmera não reconhecidos no Microsoft Teams',
    categoriaNome: 'E-mail e Colaboração',
    conteudo:
      'Se o usuário não consegue usar áudio ou vídeo em reuniões do Teams: 1) Verifique em Configurações do Windows > Privacidade e Segurança > Câmera e Microfone se a permissão para aplicativos desktop está ativada; 2) Confira se a câmera não está com o obturador físico (privacy shutter) fechado; 3) Limpe o cache do novo Teams fechando o app e removendo o conteúdo de %localappdata%\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache.',
  },
  {
    titulo: 'Procedimento para diagnóstico de Tela Azul (BSOD) MEMORY_MANAGEMENT e DRIVER_IRQL',
    categoriaNome: 'Hardware e Periféricos',
    conteudo:
      'Para diagnosticar reinicializações súbitas por BSOD: 1) Coletar os arquivos de minidump em C:\\Windows\\Minidump; 2) Executar verificação de integridade do sistema com "sfc /scannow" e "DISM /Online /Cleanup-Image /RestoreHealth"; 3) Atualizar drivers de chipset e vídeo via utilitário oficial do fabricante (Dell Command Update / Lenovo System Update); 4) Rodar o Diagnóstico de Memória do Windows (mdsched.exe) para descartar defeito físico no pente de RAM.',
  },
  {
    titulo: 'Mapeamento de pastas de rede SMB e correção de erro "Credenciais inválidas"',
    categoriaNome: 'Rede e Conectividade',
    conteudo:
      'Ao tentar mapear um compartilhamento \\\\servidor\\departamento e receber erro de acesso negado mesmo com permissão no grupo de segurança do AD: 1) Peça ao usuário para fazer logoff e logon novamente a fim de renovar o ticket Kerberos com o novo grupo; 2) Remova conexões antigas em cache com "net use * /delete /y"; 3) Mapeie novamente informando o domínio explícito (DOMINIO\\usuario).',
  },
  {
    titulo: 'Investigação de consultas lentas e bloqueios (locks) no PostgreSQL',
    categoriaNome: 'Banco de Dados e Servidores',
    conteudo:
      'Quando relatórios internos apresentam timeout no banco PostgreSQL: 1) Consulte pg_stat_activity filtrando por state = active e wait_event_type = Lock; 2) Identifique sessões bloqueadoras com pg_blocking_pids(pid); 3) Analise o plano de execução da query lenta usando EXPLAIN (ANALYZE, BUFFERS) para verificar se há Sequential Scan em tabelas grandes e crie o índice B-tree ou HNSW adequado.',
  },
  {
    titulo: 'Renovação de certificado SSL/TLS interno no proxy reverso Nginx',
    categoriaNome: 'Segurança da Informação',
    conteudo:
      'Quando navegadores exibem NET::ERR_CERT_DATE_INVALID ao acessar sistemas internos HTTPS: 1) Gere o novo CSR e assine na CA corporativa (ou execute certbot renew para domínios públicos); 2) Substitua os arquivos fullchain.pem e privkey.pem em /etc/nginx/ssl/; 3) Valide a configuração com "nginx -t"; 4) Aplique sem downtime com "systemctl reload nginx".',
  },
  {
    titulo: 'Configuração de caixa de e-mail compartilhada e permissão Enviar Como no Exchange',
    categoriaNome: 'E-mail e Colaboração',
    conteudo:
      'Para conceder acesso de um setor a uma caixa compartilhada (ex.: financeiro@empresa.com.br): 1) Acesse o Exchange Admin Center > Recipients > Mailboxes; 2) Selecione a caixa compartilhada e clique em Delegation; 3) Adicione o usuário em "Read and manage (Full Access)" e em "Send as"; 4) O mapeamento automático (Automapping) adicionará a caixa ao Outlook do usuário em até 30 minutos.',
  },
  {
    titulo: 'Substituição de bateria estufada e calibração de energia em notebooks corporativos',
    categoriaNome: 'Hardware e Periféricos',
    conteudo:
      'Caso o touchpad do notebook apresente elevação ou o equipamento desligue imediatamente ao desconectar a fonte: 1) Gere o relatório de saúde da bateria executando "powercfg /batteryreport"; 2) Se a capacidade de carga total estiver abaixo de 40% da capacidade de projeto ou houver estufamento físico, desligue o equipamento imediatamente por segurança e agende a substituição da bateria.',
  },
  {
    titulo: 'Correção de erro de macros VBA bloqueadas no Excel após atualização do Office',
    categoriaNome: 'Software e Aplicativos',
    conteudo:
      'Planilhas financeiras baixadas da rede ou e-mail têm macros bloqueadas por padrão devido ao atributo Mark of the Web (MOTW). Para liberar com segurança: 1) Clique com o botão direito no arquivo .xlsm > Propriedades e marque "Desbloquear"; 2) Para pastas de rede internas, adicione o caminho UNC (\\\\servidor\\setor) em Opções do Excel > Central de Confiabilidade > Locais Confiáveis.',
  },
  {
    titulo: 'Restauração de arquivos excluídos acidentalmente via Volume Shadow Copy (VSS)',
    categoriaNome: 'Banco de Dados e Servidores',
    conteudo:
      'Quando um usuário apaga arquivos em pasta compartilhada do File Server: 1) Clique com o botão direito na pasta pai > Propriedades > aba Versões Anteriores; 2) Escolha o snapshot do horário anterior à exclusão (gerado às 08h, 12h e 18h); 3) Clique em "Abrir" e copie apenas os arquivos necessários de volta para a pasta de produção.',
  },
  {
    titulo: 'Liberação de perfil de acesso e alçada de aprovação no módulo de Compras do ERP',
    categoriaNome: 'Sistemas Internos (ERP/CRM)',
    conteudo:
      'Para liberar permissão de aprovação de pedidos de compra no ERP: 1) Verifique a aprovação do gestor imediato no chamado; 2) Acesse Administração > Segurança > Perfis de Usuário no ERP; 3) Associe o usuário ao grupo ALCADA_COMPRAS_NIVEL_2 e vincule o centro de custo correspondente; 4) Solicite que o usuário saia e entre novamente no sistema.',
  },
  {
    titulo: 'Como resolver falha de digitalização SMB (Scan to Folder) em multifuncionais',
    categoriaNome: 'Impressoras e Digitalização',
    conteudo:
      'Quando a impressora multifuncional exibe "Erro de transmissão / Falha ao conectar ao servidor" ao escanear para pasta: 1) Acesse a interface web da multifuncional pelo IP; 2) No catálogo de endereços, verifique se o protocolo SMBv2/SMBv3 está habilitado (o SMBv1 é bloqueado por segurança); 3) Atualize a senha da conta de serviço do scanner caso tenha expirado e teste a conexão.',
  },
];

// ---------------------------------------------------------------------------
// 4. Conjunto de 40 Chamados "Realistas" Escritos à Mão (com solução completa)
// ---------------------------------------------------------------------------
const CHAMADOS_REALISTAS: readonly ChamadoRealistaSeed[] = [
  {
    titulo: 'Conta bloqueada no Windows e e-mail após troca de senha recente',
    descricao:
      'Troquei minha senha ontem à tarde, mas hoje cedo minha conta bloqueou três vezes seguidas mesmo digitando a senha nova corretamente.',
    solucao:
      'Desbloqueada a conta no Active Directory, removidas as credenciais antigas salvas no Gerenciador de Credenciais do Windows e reconectado o Wi-Fi corporativo no celular do usuário, que estava tentando autenticar em background com a senha antiga.',
    categoriaNome: 'Acesso e Autenticação',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['senha', 'active-directory', 'wifi'],
    comentarioSolicitante: 'Mesmo depois de esperar 30 minutos continua bloqueando sozinho.',
    comentarioAtendente: 'Identificamos que seu celular estava tentando conectar na rede Wi-Fi corporativa com a senha antiga. Limpamos o cache e desbloqueamos no AD.',
  },
  {
    titulo: 'Esqueci minha senha de rede e não consigo fazer login no notebook',
    descricao:
      'Voltei de férias hoje e não lembro a senha de acesso ao computador da empresa. Preciso de redefinição urgente.',
    solucao:
      'Identidade validada com a gestora da área. Senha redefinida no Active Directory com flag de troca obrigatória no primeiro logon. Usuário conectou o cabo de rede na estação para atualizar o cache de domínio e logou com sucesso.',
    categoriaNome: 'Acesso e Autenticação',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['senha', 'active-directory'],
    comentarioSolicitante: 'Estou na mesa 14 do 3º andar com cabo de rede conectado.',
    comentarioAtendente: 'Senha temporária gerada e validada. Acesso normalizado.',
  },
  {
    titulo: 'Troquei de aparelho celular e perdi o código MFA do Microsoft Authenticator',
    descricao:
      'Formatei meu celular antigo antes de migrar o aplicativo Authenticator e agora não consigo aprovar o login de duas etapas no Office 365.',
    solucao:
      'Realizada validação por videoconferência e acionado o comando "Require re-register multifactor authentication" no Microsoft Entra ID. Usuário cadastrou o novo smartphone via aka.ms/mfasetup.',
    categoriaNome: 'Acesso e Autenticação',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['mfa', 'senha'],
    comentarioSolicitante: 'Não tenho mais acesso ao aparelho antigo.',
    comentarioAtendente: 'Sessão de MFA resetada no Entra ID e novo QR Code registrado com sucesso.',
  },
  {
    titulo: 'VPN FortiClient trava em 40% com erro de certificado em home office',
    descricao:
      'Ao tentar conectar na VPN pelo FortiClient em casa, a barra de progresso para em 40% e exibe mensagem de falha na validação do certificado.',
    solucao:
      'Instalado o certificado raiz da CA interna no repositório "Autoridades de Certificação Raiz Confiáveis" do Windows e habilitado o protocolo TLS 1.2 nas Opções da Internet. Conexão VPN estabelecida normalmente.',
    categoriaNome: 'VPN e Acesso Remoto',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['vpn', 'ssl'],
    comentarioSolicitante: 'Minha internet residencial está funcionando normalmente.',
    comentarioAtendente: 'Certificado raiz importado via acesso remoto e TLS 1.2 ativado. Túnel VPN operacional.',
  },
  {
    titulo: 'VPN conecta mas para em 98% e desconecta sozinha em seguida',
    descricao:
      'O FortiClient chega até 98% durante a autenticação, fica congelado por alguns segundos e volta para a tela inicial sem conectar.',
    solucao:
      'Removido o adaptador virtual FortiSSL corrompido no Gerenciador de Dispositivos do Windows, reinstalado o driver WAN Miniport (IP/PPTP) e reiniciado o serviço FortiClient Service Scheduler.',
    categoriaNome: 'VPN e Acesso Remoto',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['vpn', 'rede'],
    comentarioSolicitante: 'Começou a acontecer depois da atualização do Windows ontem.',
    comentarioAtendente: 'Adaptador virtual recriado e serviço da VPN reiniciado. Teste de ping para a intranet OK.',
  },
  {
    titulo: 'Conectado na VPN mas não consigo acessar pastas da rede nem sistemas internos por nome',
    descricao:
      'A VPN mostra status conectado, porém quando tento abrir o sistema interno ou a pasta \\\\arquivos\\financeiro dá erro de caminho não encontrado.',
    solucao:
      'Configurado o sufixo DNS corporativo (empresa.local) e priorizada a métrica da interface virtual da VPN. Executado ipconfig /flushdns; resolução de nomes internos normalizada.',
    categoriaNome: 'VPN e Acesso Remoto',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['vpn', 'dns'],
    comentarioSolicitante: 'Pelo endereço IP numérico eu consigo abrir, só pelo nome que não.',
    comentarioAtendente: 'Ajustado o sufixo DNS no adaptador VPN e limpo o cache DNS.',
  },
  {
    titulo: 'Notebook conectado ao Wi-Fi corporativo mas exibe "Sem acesso à Internet"',
    descricao:
      'Meu notebook conecta na rede Wi-Fi da matriz, porém fica com ícone de globo sem internet e IP começando com 169.254.',
    solucao:
      'Liberada a concessão presa no escopo DHCP da VLAN corporativa e executados os comandos netsh winsock reset, netsh int ip reset e ipconfig /renew na máquina do usuário.',
    categoriaNome: 'Rede e Conectividade',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['wifi', 'dns'],
    comentarioSolicitante: 'Outros colegas da mesma sala estão navegando normalmente.',
    comentarioAtendente: 'Pilha TCP/IP redefinida e novo endereço IP válido atribuído pelo DHCP.',
  },
  {
    titulo: 'Quedas constantes de conexão na sala de reuniões do 4º andar',
    descricao:
      'Durante chamadas de vídeo na sala de reunião principal, o sinal de Wi-Fi cai a cada 10 minutos para todos os participantes.',
    solucao:
      'Identificado que o Access Point UniFi do 4º andar estava com conflito de canal em 2.4GHz e porta de switch negociando em 100Mbps Half-Duplex. Substituído o patch cord Cat6 no patch panel e fixado canal 5GHz não sobreposto.',
    categoriaNome: 'Rede e Conectividade',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['wifi', 'hardware'],
    comentarioSolicitante: 'Isso está prejudicando as reuniões com clientes.',
    comentarioAtendente: 'Patch cord substituído no rack do 4º andar e canal 5GHz ajustado no controlador Wi-Fi.',
  },
  {
    titulo: 'Acesso negado ao mapear pasta compartilhada do setor de Contabilidade',
    descricao:
      'Fui transferida para a Contabilidade, mas ao tentar abrir a pasta \\\\srv-arquivos\\contabil recebo erro de permissão negada.',
    solucao:
      'Adicionado o usuário ao grupo de segurança GRP_FS_CONTABILIDADE_RW no Active Directory, realizado logoff/logon para atualização do token Kerberos e mapeada a unidade Z: via script.',
    categoriaNome: 'Rede e Conectividade',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['active-directory', 'dns'],
    comentarioSolicitante: 'O gestor já aprovou meu acesso.',
    comentarioAtendente: 'Grupo AD aplicado e unidade Z: mapeada com leitura e gravação.',
  },
  {
    titulo: 'Impressora do setor comercial não imprime e acumula documentos na fila',
    descricao:
      'Enviamos vários contratos para a impressora HP LaserJet do comercial e todos ficam travados na fila com status "Erro - Imprimindo".',
    solucao:
      'Encerrado o serviço Print Spooler no servidor de impressão, limpos os arquivos temporários corrompidos em C:\\Windows\\System32\\spool\\PRINTERS e desmarcada a opção "Habilitar status SNMP" na porta TCP/IP 9100.',
    categoriaNome: 'Impressoras e Digitalização',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['impressora', 'spooler'],
    comentarioSolicitante: 'Temos 15 documentos na fila travando todo o setor.',
    comentarioAtendente: 'Spooler limpo e porta TCP/IP ajustada. Impressora voltou a imprimir normalmente.',
  },
  {
    titulo: 'Multifuncional Ricoh não envia documentos escaneados para a pasta de rede (Scan to Folder)',
    descricao:
      'Ao digitalizar documentos na multifuncional do jurídico, aparece "Falha na transmissão para o destino SMB".',
    solucao:
      'Atualizada a configuração de SMB na interface web da multifuncional Ricoh para utilizar SMBv2/SMBv3 e renovada a senha da conta de serviço svc_scanner no catálogo de endereços.',
    categoriaNome: 'Impressoras e Digitalização',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['impressora', 'senha'],
    comentarioSolicitante: 'A cópia comum funciona, só o envio para a pasta que dá erro.',
    comentarioAtendente: 'Protocolo SMBv2 ativado e credencial da conta de serviço atualizada no painel da Ricoh.',
  },
  {
    titulo: 'Impressões saindo com manchas verticais pretas e papel atolando na bandeja 2',
    descricao:
      'A impressora do RH está manchando todas as folhas com uma faixa vertical escura e enroscando papel quando puxa da bandeja 2.',
    solucao:
      'Substituído o cilindro de imagem (drum unit) desgastado, realizada limpeza do rolete pickup da bandeja 2 com álcool isopropílico e impresso teste de calibração sem manchas.',
    categoriaNome: 'Impressoras e Digitalização',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['impressora', 'hardware'],
    comentarioSolicitante: 'Já trocamos o toner ontem e a mancha continuou.',
    comentarioAtendente: 'Unidade de imagem (cilindro) trocada e roletes limpos. Teste de impressão aprovado.',
  },
  {
    titulo: 'Microsoft Outlook trava na tela "Processando" e não abre os e-mails',
    descricao:
      'Meu Outlook congela logo ao abrir na tela azul de carregamento e informa que o arquivo de dados .ost atingiu o tamanho máximo ou está corrompido.',
    solucao:
      'Fechado o Outlook, renomeado o arquivo cache local de 48GB em %localappdata%\\Microsoft\\Outlook para .ost.old, ajustada a janela de sincronização offline do Exchange para 12 meses e recriado o perfil.',
    categoriaNome: 'E-mail e Colaboração',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['outlook'],
    comentarioSolicitante: 'Preciso responder e-mails urgentes de fornecedores.',
    comentarioAtendente: 'Arquivo OST recriado com cache de 1 ano. Outlook abrindo instantaneamente.',
  },
  {
    titulo: 'Não consigo enviar e-mails em nome da caixa compartilhada do Financeiro',
    descricao:
      'Já consigo visualizar as mensagens da caixa financeiro@empresa.com.br no meu Outlook, mas quando tento responder dá erro de permissão Send As.',
    solucao:
      'Adicionada a permissão explícita "Send As" (Enviar como) para a usuária nas configurações de delegação da caixa compartilhada no Exchange Admin Center e atualizada a Global Address List (GAL) offline.',
    categoriaNome: 'E-mail e Colaboração',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['outlook'],
    comentarioSolicitante: 'A mensagem volta imediatamente com erro do servidor Exchange.',
    comentarioAtendente: 'Delegação Send As aplicada no Exchange Online e testado o envio com sucesso.',
  },
  {
    titulo: 'Câmera e microfone não funcionam durante chamadas no Microsoft Teams',
    descricao:
      'No Microsoft Teams ninguém me ouve e minha webcam aparece com tela preta, embora funcione normalmente no aplicativo Câmera do Windows.',
    solucao:
      'Habilitada a permissão de acesso à câmera e microfone para aplicativos desktop em Configurações de Privacidade do Windows 11 e limpo o cache local do novo Microsoft Teams em %localappdata%\\Packages\\MSTeams_8wekyb3d8bbwe.',
    categoriaNome: 'E-mail e Colaboração',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['teams', 'hardware'],
    comentarioSolicitante: 'Tenho reunião de alinhamento às 14h.',
    comentarioAtendente: 'Cache do Teams limpo e permissões de áudio/vídeo liberadas. Chamada de teste OK.',
  },
  {
    titulo: 'Notebook pedindo chave de recuperação do BitLocker de 48 dígitos ao ligar',
    descricao:
      'Ao ligar o notebook hoje pela manhã, apareceu uma tela azul do BitLocker exigindo a chave de recuperação após uma atualização automática de BIOS.',
    solucao:
      'Localizada a chave de recuperação de 48 dígitos no objeto do computador no Active Directory/Entra ID, desbloqueado o volume C:, suspensa e reativada a proteção do TPM 2.0 com manage-bde para atualizar os registradores PCR.',
    categoriaNome: 'Segurança da Informação',
    prioridade: PrioridadeChamado.URGENTE,
    tags: ['bitlocker', 'hardware'],
    comentarioSolicitante: 'O ID da chave que aparece na tela começa com 4F8A91C2.',
    comentarioAtendente: 'Chave fornecida e protetores do TPM ressincronizados para não pedir novamente no boot.',
  },
  {
    titulo: 'Navegador bloqueia acesso ao portal interno com alerta de Certificado SSL expirado',
    descricao:
      'Ao acessar https://intranet.empresa.local no Chrome e no Edge, aparece "Sua conexão não é particular (NET::ERR_CERT_DATE_INVALID)".',
    solucao:
      'Renovado o certificado TLS wildcard no servidor Nginx de proxy reverso, atualizado o bundle fullchain.pem e recarregado o serviço nginx sem interrupção.',
    categoriaNome: 'Segurança da Informação',
    prioridade: PrioridadeChamado.URGENTE,
    tags: ['ssl', 'dns'],
    comentarioSolicitante: 'Todos os colaboradores do atendimento estão sem conseguir abrir a intranet.',
    comentarioAtendente: 'Novo certificado SSL instalado no Nginx e validado em todos os navegadores.',
  },
  {
    titulo: 'Suspeita de e-mail de phishing recebido em nome do departamento de RH',
    descricao:
      'Recebi um e-mail pedindo para clicar em um link externo e digitar minha senha corporativa para consultar um suposto reajuste salarial.',
    solucao:
      'Analisado o cabeçalho da mensagem, bloqueado o domínio remetente malicioso no filtro antispam/Defender, executada purga da mensagem em todas as caixas postais da organização e confirmado que o usuário não inseriu credenciais.',
    categoriaNome: 'Segurança da Informação',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['senha', 'outlook'],
    comentarioSolicitante: 'Não cheguei a clicar no link, apenas encaminhei para análise.',
    comentarioAtendente: 'Remetente bloqueado no gateway de e-mail e mensagens removidas das demais caixas.',
  },
  {
    titulo: 'Erro de rejeição na emissão de Nota Fiscal Eletrônica (NF-e) no ERP por certificado vencido',
    descricao:
      'O módulo de faturamento do ERP não está aprovando nenhuma NF-e na SEFAZ, retornando erro "Falha na validação do Certificado Digital A1".',
    solucao:
      'Importado o novo arquivo .pfx do certificado digital A1 renovado da matriz no servidor do ERP, configurada a senha nos parâmetros fiscais e reiniciado o serviço transmissor de NF-e.',
    categoriaNome: 'Sistemas Internos (ERP/CRM)',
    prioridade: PrioridadeChamado.URGENTE,
    tags: ['erp', 'nota-fiscal', 'ssl'],
    comentarioSolicitante: 'Os caminhões estão aguardando na expedição para faturar.',
    comentarioAtendente: 'Certificado A1 atualizado no ERP e 12 notas fiscais pendentes autorizadas na SEFAZ.',
  },
  {
    titulo: 'Usuário sem permissão para aprovar pedidos de compra no módulo Suprimentos do ERP',
    descricao:
      'Assumi a coordenação de compras esta semana, porém o botão "Aprovar Pedido" aparece desabilitado para meu usuário no ERP.',
    solucao:
      'Vinculado o usuário ao perfil ALCADA_COMPRAS_COORDENACAO e associados os centros de custo 201 e 205 na tabela de alçadas do ERP.',
    categoriaNome: 'Sistemas Internos (ERP/CRM)',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['erp'],
    comentarioSolicitante: 'Segue em anexo a aprovação da diretoria.',
    comentarioAtendente: 'Perfil e alçada de centro de custo liberados no ERP.',
  },
  {
    titulo: 'Erro de diferença de centavos no cálculo de ICMS ST ao lançar nota de entrada no ERP',
    descricao:
      'Não consigo finalizar o lançamento da nota fiscal 45892 no módulo de recebimento porque o sistema trava por divergência de R$ 0,02 no ICMS ST.',
    solucao:
      'Ajustada a tolerância de arredondamento de impostos estaduais para R$ 0,05 nos parâmetros fiscais da operação de entrada no ERP, permitindo a escrituração da nota conforme o XML.',
    categoriaNome: 'Sistemas Internos (ERP/CRM)',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['erp', 'nota-fiscal'],
    comentarioSolicitante: 'O XML do fornecedor está correto na receita.',
    comentarioAtendente: 'Parâmetro de tolerância de arredondamento ajustado e nota lançada com sucesso.',
  },
  {
    titulo: 'CRM não está sincronizando novos leads cadastrados pelo site institucional',
    descricao:
      'Desde ontem às 18h os formulários preenchidos no site não estão gerando oportunidades para a equipe comercial no CRM.',
    solucao:
      'Identificado que o token de integração da API Webhook do CRM havia expirado. Gerada nova API Key no CRM, atualizada a variável de ambiente no backend do site e reprocessados os 34 leads retidos na fila.',
    categoriaNome: 'Sistemas Internos (ERP/CRM)',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['erp'],
    comentarioSolicitante: 'Vários clientes ligaram dizendo que preencheram o formulário.',
    comentarioAtendente: 'Token de webhook renovado e fila de 34 leads reprocessada sem perda de dados.',
  },
  {
    titulo: 'Notebook apresentando Tela Azul (BSOD MEMORY_MANAGEMENT) várias vezes ao dia',
    descricao:
      'Meu notebook Dell Latitude reinicia sozinho com uma tela azul escrita MEMORY_MANAGEMENT sempre que abro várias abas e planilhas.',
    solucao:
      'Diagnóstico Dell e MemTest identificaram falhas de endereço no módulo SODIMM DDR4 do slot 2. Substituído o pente de 8GB defeituoso por um novo módulo de 16GB e atualizado a BIOS.',
    categoriaNome: 'Hardware e Periféricos',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['hardware', 'bsod'],
    comentarioSolicitante: 'Perdi uma planilha que estava editando quando reiniciou.',
    comentarioAtendente: 'Memória RAM defeituosa substituída e teste de estresse executado sem erros.',
  },
  {
    titulo: 'Disco C: com 100% de uso e extrema lentidão ao iniciar o Windows',
    descricao:
      'O computador da recepção leva mais de 15 minutos para ligar e no Gerenciador de Tarefas o disco fica cravado em 100% de uso.',
    solucao:
      'Clonado o sistema operacional do HD mecânico antigo (com setores realocados no S.M.A.R.T.) para um SSD NVMe de 512GB e desativados serviços de telemetria desnecessários. Tempo de boot reduzido para 18 segundos.',
    categoriaNome: 'Hardware e Periféricos',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['hardware', 'ssd'],
    comentarioSolicitante: 'Trava até para abrir o navegador.',
    comentarioAtendente: 'Substituído HD por SSD NVMe de 512GB. Máquina operando com alto desempenho.',
  },
  {
    titulo: 'Segundo monitor conectado na dock station USB-C pisca e perde sinal de vídeo',
    descricao:
      'Quando conecto meu notebook na dock station USB-C, o monitor secundário HDMI fica piscando a cada minuto até apagar de vez.',
    solucao:
      'Atualizado o firmware da Dock Station Dell WD19, instalado o driver mais recente da GPU Intel Iris Xe e substituído o cabo HDMI 1.4 por um cabo DisplayPort certificado.',
    categoriaNome: 'Hardware e Periféricos',
    prioridade: PrioridadeChamado.BAIXA,
    tags: ['hardware'],
    comentarioSolicitante: 'Se ligo o HDMI direto no notebook funciona.',
    comentarioAtendente: 'Firmware da dock atualizado e conexão trocada para DisplayPort. Vídeo estável.',
  },
  {
    titulo: 'Bateria do notebook não carrega ("0% disponível, conectado") e desliga fora da tomada',
    descricao:
      'O ícone da bateria mostra que o carregador está conectado, mas a carga não sai de 0% e se esbarro no cabo o notebook desliga na hora.',
    solucao:
      'Gerado laudo via powercfg /batteryreport constatando degradação completa das células da bateria. Realizada a troca da bateria interna original e reset do controlador SMC/BIOS.',
    categoriaNome: 'Hardware e Periféricos',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['hardware'],
    comentarioSolicitante: 'Não consigo levar o notebook para as salas de reunião.',
    comentarioAtendente: 'Bateria nova instalada e testada com autonomia estimada de 6 horas.',
  },
  {
    titulo: 'Planilha de fechamento contábil com macros VBA bloqueadas pelo Excel',
    descricao:
      'Ao abrir a planilha de conciliação na rede, o Excel exibe uma faixa vermelha "Risco de Segurança: a Microsoft bloqueou a execução de macros".',
    solucao:
      'Adicionado o caminho de rede \\\\srv-arquivos\\contabil aos Locais Confiáveis da Central de Confiabilidade do Excel via GPO para o setor contábil e removido o atributo Mark of the Web do arquivo.',
    categoriaNome: 'Software e Aplicativos',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['erp'],
    comentarioSolicitante: 'Hoje é dia de fechamento mensal e precisamos do botão de geração do lote.',
    comentarioAtendente: 'Servidor de arquivos incluído nos Locais Confiáveis do Office. Macros funcionando.',
  },
  {
    titulo: 'Mensagem de "Produto Não Licenciado" no Word e Excel impedindo edição',
    descricao:
      'Todos os aplicativos do meu pacote Office 365 estão com os botões de edição cinzas e mostram aviso de assinatura expirada no topo.',
    solucao:
      'Reatribuída a licença Microsoft 365 Business Standard no portal administrativo, executado o script ospp.vbs /act para limpar chaves antigas em conflito e refeito o login no Office.',
    categoriaNome: 'Software e Aplicativos',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['outlook', 'senha'],
    comentarioSolicitante: 'Só consigo abrir arquivos em modo somente leitura.',
    comentarioAtendente: 'Licença reativada e conflito de chave KMS antiga removido.',
  },
  {
    titulo: 'Docker Desktop e WSL2 consumindo 95GB do disco C: na máquina de desenvolvimento',
    descricao:
      'Meu SSD de 256GB ficou sem espaço livre porque o arquivo ext4.vhdx do WSL2 cresceu até ocupar quase todo o disco.',
    solucao:
      'Executado docker system prune -a --volumes, encerrado o WSL com wsl --shutdown e compactado o disco virtual ext4.vhdx via utilitário diskpart (compact vdisk), liberando 68GB no disco C:.',
    categoriaNome: 'Software e Aplicativos',
    prioridade: PrioridadeChamado.MEDIA,
    tags: ['ssd', 'banco-de-dados'],
    comentarioSolicitante: 'Mesmo apagando os containers o espaço não volta no Windows.',
    comentarioAtendente: 'Imagem VHDX compactada via diskpart e configurado limite de memória no .wslconfig.',
  },
  {
    titulo: 'Lentidão severa ao gerar relatório de vendas anual no banco PostgreSQL',
    descricao:
      'A consulta de fechamento de vendas no painel gerencial está dando timeout após 60 segundos de espera no PostgreSQL.',
    solucao:
      'Analisada a consulta com EXPLAIN ANALYZE, identificado Sequential Scan em tabela de 4 milhões de registros e criado índice composto B-tree em (data_venda, filial_id, status). Tempo de execução caiu de 62s para 45ms.',
    categoriaNome: 'Banco de Dados e Servidores',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['banco-de-dados', 'postgresql'],
    comentarioSolicitante: 'O painel trava toda vez que filtramos o período de 12 meses.',
    comentarioAtendente: 'Índice composto criado de forma concorrente (CREATE INDEX CONCURRENTLY). Consulta otimizada.',
  },
  {
    titulo: 'Erro "FATAL: remaining connection slots are reserved for superuser" no PostgreSQL de homologação',
    descricao:
      'As aplicações do ambiente de homologação pararam de conectar no banco PostgreSQL acusando esgotamento do limite de conexões.',
    solucao:
      'Encerradas conexões órfãs em estado "idle in transaction" via pg_terminate_backend, ajustado o tamanho máximo do pool de conexões nos microsserviços para evitar vazamento e configurado idle_in_transaction_session_timeout = 60s.',
    categoriaNome: 'Banco de Dados e Servidores',
    prioridade: PrioridadeChamado.URGENTE,
    tags: ['banco-de-dados', 'postgresql'],
    comentarioSolicitante: 'Nenhum serviço consegue subir no ambiente de staging.',
    comentarioAtendente: 'Sessões ociosas finalizadas e pool de conexões calibrado.',
  },
  {
    titulo: 'Solicitação de restauração de planilha apagada por engano na pasta do Departamento Pessoal',
    descricao:
      'Excluí acidentalmente a pasta "Folha_Outubro" dentro do diretório compartilhado do RH há cerca de 20 minutos.',
    solucao:
      'Acessado o snapshot das 12h00 do Volume Shadow Copy (VSS) no servidor de arquivos Windows Server e restaurada integralmente a pasta Folha_Outubro com todos os 18 arquivos.',
    categoriaNome: 'Banco de Dados e Servidores',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['backup'],
    comentarioSolicitante: 'Não foi para a lixeira porque estava na unidade de rede M:.',
    comentarioAtendente: 'Arquivos recuperados a partir da cópia de sombra das 12h00 e validados pelo setor.',
  },
  {
    titulo: 'Falha na rotina de backup noturno do banco de produção por falta de espaço no storage',
    descricao:
      'O alerta de monitoramento acusou erro no job de pg_dump das 02h00 por código "No space left on device" no volume /mnt/backups.',
    solucao:
      'Ajustada a política de retenção do script de backup para remover dumps locais com mais de 14 dias já sincronizados no bucket S3 e executado o backup completo manual com sucesso.',
    categoriaNome: 'Banco de Dados e Servidores',
    prioridade: PrioridadeChamado.URGENTE,
    tags: ['backup', 'banco-de-dados', 'postgresql'],
    comentarioSolicitante: 'Alerta automático gerado pelo Zabbix.',
    comentarioAtendente: 'Expurgo de dumps antigos executado, 180GB liberados e backup diário concluído.',
  },
  {
    titulo: 'Busca semântica de chamados retornando erro de dimensão de vetor no pgvector',
    descricao:
      'Ao indexar novos documentos na tabela Documentos, o PostgreSQL retorna erro "expected 1536 dimensions, not 768".',
    solucao:
      'Ajustada a chamada ao modelo gemini-embedding-001 para passar explicitamente config: { outputDimensionality: 1536 } compatível com a coluna VECTOR(1536) e recriado o índice HNSW.',
    categoriaNome: 'Banco de Dados e Servidores',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['banco-de-dados', 'postgresql'],
    comentarioSolicitante: 'Ocorreu após atualizarmos o modelo de embedding.',
    comentarioAtendente: 'Dimensionalidade 1536 fixada no serviço de embeddings e validada com busca de cosseno.',
  },
  {
    titulo: 'Teclado do notebook digitando números no lugar de letras (U, I, O, J, K, L)',
    descricao:
      'Quando digito as letras U, I, O ou J no teclado do notebook, saem números 4, 5, 6 e 1 como se fosse calculadora.',
    solucao:
      'Desativado o NumLock integrado (atalho Fn + F11 / Fn + NumLk) que estava ativando o teclado numérico sobreposto nas teclas alfabéticas e atualizado o layout para Português (Brasil ABNT2).',
    categoriaNome: 'Hardware e Periféricos',
    prioridade: PrioridadeChamado.BAIXA,
    tags: ['hardware'],
    comentarioSolicitante: 'Só consigo digitar minha senha usando o teclado virtual.',
    comentarioAtendente: 'NumLock sobreposto desativado via Fn + NumLk. Teclado normalizado.',
  },
  {
    titulo: 'Headset USB não sai som nos fones mas o microfone funciona nas ligações',
    descricao:
      'Meu headset Logitech aparece conectado, as pessoas me escutam, porém o áudio da chamada sai no alto-falante do notebook.',
    solucao:
      'Definido o Headset USB como "Dispositivo Padrão" e "Dispositivo de Comunicação Padrão" no Painel de Controle de Som do Windows (mmsys.cpl) e nas configurações de dispositivos do Teams.',
    categoriaNome: 'Hardware e Periféricos',
    prioridade: PrioridadeChamado.BAIXA,
    tags: ['hardware', 'teams'],
    comentarioSolicitante: 'Já troquei de porta USB e continuou igual.',
    comentarioAtendente: 'Saída padrão de comunicação alterada para o headset Logitech.',
  },
  {
    titulo: 'Erro de CORS e falha 502 Bad Gateway ao consultar API de homologação',
    descricao:
      'O frontend em React não consegue consumir a API de homologação, retornando 502 Bad Gateway no navegador.',
    solucao:
      'Reiniciado o processo Node.js no PM2 que havia caído por falta de variável DATABASE_URL no arquivo .env de homologação e validado o upstream no Nginx.',
    categoriaNome: 'Banco de Dados e Servidores',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['ssl', 'dns'],
    comentarioSolicitante: 'Precisamos homologar a entrega ainda hoje.',
    comentarioAtendente: 'Variável de ambiente adicionada e serviço Node reiniciado no PM2.',
  },
  {
    titulo: 'Assinatura de e-mail corporativa desconfigurada ao responder mensagens no Outlook',
    descricao:
      'Minha assinatura com a logo da empresa aparece quebrada e em fonte tamanho 8 sempre que respondo um e-mail externo.',
    solucao:
      'Alterado o formato de composição padrão do Outlook de Texto Simples para HTML e aplicada a assinatura padronizada com imagem hospedada em CDN.',
    categoriaNome: 'E-mail e Colaboração',
    prioridade: PrioridadeChamado.BAIXA,
    tags: ['outlook'],
    comentarioSolicitante: 'Para e-mails novos funciona, só nas respostas que perde a formatação.',
    comentarioAtendente: 'Formato HTML configurado para respostas e encaminhamentos no Outlook.',
  },
  {
    titulo: 'Acesso remoto via Área de Trabalho Remota (RDP) bloqueado por erro CredSSP',
    descricao:
      'Não consigo conectar via mstsc (RDP) no servidor de relatórios; aparece erro "Falha de autenticação - Oráculo de Criptografia CredSSP".',
    solucao:
      'Aplicado o pacote cumulativo de segurança do Windows Server no host de destino e habilitado o NLA (Network Level Authentication) atualizado em ambos os lados.',
    categoriaNome: 'VPN e Acesso Remoto',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['vpn', 'senha'],
    comentarioSolicitante: 'Até ontem conectava normalmente pelo IP 10.10.20.45.',
    comentarioAtendente: 'Patch do CredSSP aplicado no servidor de destino e conexão RDP restabelecida.',
  },
  {
    titulo: 'Pendrive criptografado corporativo não abre e pede formatação ao conectar na USB',
    descricao:
      'Conectei o pendrive de auditoria na porta USB frontal e o Windows exibe "Você precisa formatar o disco na unidade E: antes de usá-lo".',
    solucao:
      'Conectado o dispositivo diretamente na porta USB 3.0 traseira da placa-mãe (a porta frontal estava com queda de tensão de 5V) e executado chkdsk E: /f para recuperar a tabela FAT32 sem perda dos arquivos.',
    categoriaNome: 'Hardware e Periféricos',
    prioridade: PrioridadeChamado.ALTA,
    tags: ['hardware', 'backup'],
    comentarioSolicitante: 'Não posso formatar pois contém os relatórios da auditoria externa.',
    comentarioAtendente: 'Tabela de alocação recuperada via chkdsk na porta traseira e backup salvo na rede.',
  },
];

// ---------------------------------------------------------------------------
// 5. Templates auxiliares para geração sintética com @faker-js/faker (pt_BR)
// ---------------------------------------------------------------------------
const PREFIXOS_PROBLEMA_SINTETICO: readonly string[] = [
  'Lentidão ao acessar módulo',
  'Falha intermitente de autenticação no serviço',
  'Erro de permissão ao exportar dados de',
  'Indisponibilidade temporária na estação de',
  'Solicitação de configuração e suporte em',
  'Travamento inesperado durante uso de',
  'Alerta de atualização pendente no ambiente de',
  'Dificuldade de sincronização de dados em',
  'Queda de desempenho reportada pelo setor em',
  'Erro de comunicação de rede ao consultar',
];

const SOLUCOES_SINTETICAS: readonly string[] = [
  'Realizada limpeza de cache local, revalidação das permissões de grupo no diretório ativo e reinício do serviço.',
  'Atualizados os parâmetros de configuração da estação, aplicado patch corretivo e validado o acesso junto ao solicitante.',
  'Reconfigurado o perfil do usuário na aplicação, sincronizadas as credenciais e confirmado o funcionamento em teste assistido.',
  'Substituído o componente com falha, revisadas as rotas de rede da VLAN do setor e normalizada a operação.',
  'Executada rotina de manutenção preventiva, liberada a fila de processamento e homologado o retorno com a equipe.',
];

function dividirEmLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}

export async function executarSeed(opcoes?: {
  pularEmbeddings?: boolean;
}): Promise<ResumoSeed> {
  faker.seed(20261108);

  console.log('🧹 Limpando dados existentes (seed idempotente)...');
  await prisma.$transaction([
    prisma.documentos.deleteMany(),
    prisma.chamadoTag.deleteMany(),
    prisma.comentario.deleteMany(),
    prisma.chamado.deleteMany(),
    prisma.artigo.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.usuario.deleteMany(),
    prisma.categoria.deleteMany(),
    prisma.$executeRawUnsafe('ALTER SEQUENCE "Documentos_id_seq" RESTART WITH 1'),
    prisma.$executeRawUnsafe('ALTER SEQUENCE "Comentario_id_seq" RESTART WITH 1'),
    prisma.$executeRawUnsafe('ALTER SEQUENCE "Chamado_id_seq" RESTART WITH 1'),
    prisma.$executeRawUnsafe('ALTER SEQUENCE "Artigo_id_seq" RESTART WITH 1'),
    prisma.$executeRawUnsafe('ALTER SEQUENCE "Tag_id_seq" RESTART WITH 1'),
    prisma.$executeRawUnsafe('ALTER SEQUENCE "Usuario_id_seq" RESTART WITH 1'),
    prisma.$executeRawUnsafe('ALTER SEQUENCE "Categoria_id_seq" RESTART WITH 1'),
    prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Chamado_status_categoria_id_idx" ON "Chamado"("status", "categoria_id")'
    ),
    prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "chamado_fts_gin_idx"
        ON "Chamado"
        USING gin (
          to_tsvector(
            'portuguese',
            coalesce("titulo", '') || ' ' || coalesce("descricao", '') || ' ' || coalesce("solucao", '')
          )
        )
    `),
    prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw_idx
        ON "Documentos"
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `),
  ]);

  // -------------------------------------------------------------------------
  // 1. Categorias e Tags (em transação)
  // -------------------------------------------------------------------------
  console.log('📂 Criando 10 categorias e 20 tags...');
  await prisma.$transaction([
    prisma.categoria.createMany({
      data: CATEGORIAS_TI.map((cat) => ({
        nome: cat.nome,
        descricao: cat.descricao,
        ativa: true,
      })),
    }),
    prisma.tag.createMany({
      data: TAGS_TI.map((nome) => ({ nome })),
    }),
  ]);

  const [categoriasCriadas, tagsCriadas] = await Promise.all([
    prisma.categoria.findMany({ orderBy: { id: 'asc' } }),
    prisma.tag.findMany({ orderBy: { id: 'asc' } }),
  ]);

  const mapaCategoriaPorNome = new Map<string, number>(
    categoriasCriadas.map((c) => [c.nome, c.id])
  );
  const mapaTagPorNome = new Map<string, number>(
    tagsCriadas.map((t) => [t.nome, t.id])
  );

  // -------------------------------------------------------------------------
  // 2. Usuários (~50 usuários com papéis e senhas com hash bcrypt)
  // -------------------------------------------------------------------------
  console.log('🔐 Gerando hashes bcrypt e criando 50 usuários...');
  const [hashAdmin, hashAtendente, hashSolicitante] = await Promise.all([
    bcrypt.hash('Admin@Willen2026!', BCRYPT_SALT_ROUNDS),
    bcrypt.hash('Suporte@Willen2026!', BCRYPT_SALT_ROUNDS),
    bcrypt.hash('Usuario@Willen2026!', BCRYPT_SALT_ROUNDS),
  ]);

  const dadosUsuarios: Array<{
    nome: string;
    email: string;
    senha: string;
    papel: PapelUsuario;
    ativo: boolean;
  }> = [];

  for (let i = 1; i <= TOTAL_USUARIOS; i++) {
    const nome = faker.person.fullName();
    let papel: PapelUsuario = PapelUsuario.SOLICITANTE;
    let senhaHash = hashSolicitante;

    if (i <= 3) {
      papel = PapelUsuario.ADMIN;
      senhaHash = hashAdmin;
    } else if (i <= 15) {
      papel = PapelUsuario.ATENDENTE;
      senhaHash = hashAtendente;
    }

    const prefixoEmail = faker.internet
      .username({ firstName: nome.split(' ')[0], lastName: nome.split(' ').slice(-1)[0] })
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');

    dadosUsuarios.push({
      nome,
      email: `${prefixoEmail}.${i}@willen.com.br`,
      senha: senhaHash,
      papel,
      ativo: i <= 48, // 48 ativos e 2 inativos para testes realistas
    });
  }

  await prisma.usuario.createMany({ data: dadosUsuarios });

  const usuariosCriados = await prisma.usuario.findMany({ orderBy: { id: 'asc' } });
  const adminsEAtendentes = usuariosCriados.filter(
    (u) => u.papel === PapelUsuario.ADMIN || u.papel === PapelUsuario.ATENDENTE
  );
  const atendentes = usuariosCriados.filter((u) => u.papel === PapelUsuario.ATENDENTE);
  const solicitantes = usuariosCriados.filter((u) => u.papel === PapelUsuario.SOLICITANTE);

  // -------------------------------------------------------------------------
  // 3. Artigos da Base de Conhecimento (20 artigos)
  // -------------------------------------------------------------------------
  console.log('📚 Criando 20 artigos da base de conhecimento...');
  const dadosArtigos = ARTIGOS_BASE_CONHECIMENTO.map((artigo, index) => {
    const categoriaId =
      mapaCategoriaPorNome.get(artigo.categoriaNome) ?? categoriasCriadas[0].id;
    const autor = adminsEAtendentes[index % adminsEAtendentes.length];
    return {
      titulo: artigo.titulo,
      conteudo: artigo.conteudo,
      categoriaId,
      autorId: autor.id,
    };
  });

  await prisma.artigo.createMany({ data: dadosArtigos });

  // -------------------------------------------------------------------------
  // 4. Chamados (40 realistas escritos à mão + 4.960 sintéticos = 5.000 chamados)
  // -------------------------------------------------------------------------
  console.log(
    `🎫 Gerando ${TOTAL_CHAMADOS} chamados (${CHAMADOS_REALISTAS.length} realistas + ${
      TOTAL_CHAMADOS - CHAMADOS_REALISTAS.length
    } sintéticos via Faker pt_BR)...`
  );

  const agora = Date.now();
  const umDiaMs = 24 * 60 * 60 * 1000;

  interface NovoChamadoRow {
    titulo: string;
    descricao: string;
    status: StatusChamado;
    prioridade: PrioridadeChamado;
    solucao: string | null;
    resolvidoEm: Date | null;
    criadoEm: Date;
    atualizadoEm: Date;
    categoriaId: number;
    solicitanteId: number;
    atendenteId: number | null;
  }

  const todosChamados: NovoChamadoRow[] = [];

  // 4.1 Primeiro: os 40 chamados realistas escritos à mão (todos RESOLVIDO com solução rica)
  for (let i = 0; i < CHAMADOS_REALISTAS.length; i++) {
    const item = CHAMADOS_REALISTAS[i];
    const categoriaId =
      mapaCategoriaPorNome.get(item.categoriaNome) ?? categoriasCriadas[0].id;
    const solicitante = solicitantes[i % solicitantes.length];
    const atendente = atendentes[i % atendentes.length];
    const criadoEm = new Date(agora - (60 - i) * umDiaMs);
    const resolvidoEm = new Date(criadoEm.getTime() + 4 * 60 * 60 * 1000);

    todosChamados.push({
      titulo: item.titulo,
      descricao: item.descricao,
      status: StatusChamado.RESOLVIDO,
      prioridade: item.prioridade,
      solucao: item.solucao,
      resolvidoEm,
      criadoEm,
      atualizadoEm: resolvidoEm,
      categoriaId,
      solicitanteId: solicitante.id,
      atendenteId: atendente.id,
    });
  }

  // 4.2 Em seguida: 4.960 chamados gerados com @faker-js/faker (locale pt_BR)
  const listaStatus: readonly StatusChamado[] = [
    StatusChamado.ABERTO,
    StatusChamado.EM_ANDAMENTO,
    StatusChamado.AGUARDANDO,
    StatusChamado.RESOLVIDO,
    StatusChamado.FECHADO,
  ];
  const listaPrioridades: readonly PrioridadeChamado[] = [
    PrioridadeChamado.BAIXA,
    PrioridadeChamado.MEDIA,
    PrioridadeChamado.ALTA,
    PrioridadeChamado.URGENTE,
  ];

  const totalSinteticos = TOTAL_CHAMADOS - CHAMADOS_REALISTAS.length;

  for (let i = 0; i < totalSinteticos; i++) {
    const categoria = categoriasCriadas[i % categoriasCriadas.length];
    const solicitante = solicitantes[i % solicitantes.length];
    const status = listaStatus[i % listaStatus.length];
    const prioridade = listaPrioridades[(i * 3) % listaPrioridades.length];

    const prefixo = PREFIXOS_PROBLEMA_SINTETICO[i % PREFIXOS_PROBLEMA_SINTETICO.length];
    const departamento = faker.commerce.department();
    const detalheFaker = faker.hacker.phrase();

    const titulo = `${prefixo} ${categoria.nome} — Setor ${departamento} (#${i + 1})`;
    const descricao = `${faker.lorem.sentence()} O colaborador informou: "${detalheFaker}". Impacto registrado no setor de ${departamento}.`;

    const temAtendente = status !== StatusChamado.ABERTO;
    const atendente = temAtendente ? atendentes[i % atendentes.length] : null;

    const foiResolvido =
      status === StatusChamado.RESOLVIDO || status === StatusChamado.FECHADO;
    const criadoEm = new Date(
      agora - faker.number.int({ min: 1, max: 180 }) * umDiaMs
    );
    const resolvidoEm = foiResolvido
      ? new Date(
          criadoEm.getTime() + faker.number.int({ min: 1, max: 48 }) * 3600 * 1000
        )
      : null;

    const solucao = foiResolvido
      ? `${SOLUCOES_SINTETICAS[i % SOLUCOES_SINTETICAS.length]} (Atendimento referente a ${categoria.nome}).`
      : null;

    todosChamados.push({
      titulo,
      descricao,
      status,
      prioridade,
      solucao,
      resolvidoEm,
      criadoEm,
      atualizadoEm: resolvidoEm ?? criadoEm,
      categoriaId: categoria.id,
      solicitanteId: solicitante.id,
      atendenteId: atendente ? atendente.id : null,
    });
  }

  // Inserir os 5.000 chamados em lotes dentro de uma transação
  const lotesChamados = dividirEmLotes(todosChamados, TAMANHO_LOTE_INSERT);
  await prisma.$transaction(
    lotesChamados.map((lote) => prisma.chamado.createMany({ data: lote }))
  );

  // Buscar IDs gerados na ordem de inserção
  const chamadosInseridos = await prisma.chamado.findMany({
    select: {
      id: true,
      solicitanteId: true,
      atendenteId: true,
      status: true,
      criadoEm: true,
    },
    orderBy: { id: 'asc' },
  });

  // -------------------------------------------------------------------------
  // 5. Comentários e Tags dos Chamados (createMany em lotes transacionais)
  // -------------------------------------------------------------------------
  console.log('💬 Gerando comentários e associações de tags (N:N)...');

  const todosComentarios: Array<{
    chamadoId: number;
    autorId: number;
    conteudo: string;
    criadoEm: Date;
  }> = [];

  const todosChamadoTags: Array<{
    chamadoId: number;
    tagId: number;
  }> = [];

  // 5.1 Comentários e tags dos 40 chamados realistas
  for (let i = 0; i < CHAMADOS_REALISTAS.length; i++) {
    const chamadoDb = chamadosInseridos[i];
    const seedRealista = CHAMADOS_REALISTAS[i];
    const autorAtendenteId = chamadoDb.atendenteId ?? atendentes[0].id;

    todosComentarios.push(
      {
        chamadoId: chamadoDb.id,
        autorId: chamadoDb.solicitanteId,
        conteudo: seedRealista.comentarioSolicitante,
        criadoEm: new Date(chamadoDb.criadoEm.getTime() + 15 * 60 * 1000),
      },
      {
        chamadoId: chamadoDb.id,
        autorId: autorAtendenteId,
        conteudo: seedRealista.comentarioAtendente,
        criadoEm: new Date(chamadoDb.criadoEm.getTime() + 90 * 60 * 1000),
      }
    );

    for (const nomeTag of seedRealista.tags) {
      const tagId = mapaTagPorNome.get(nomeTag);
      if (tagId !== undefined) {
        todosChamadoTags.push({
          chamadoId: chamadoDb.id,
          tagId,
        });
      }
    }
  }

  // 5.2 Comentários e tags para os demais chamados sintéticos
  for (let i = CHAMADOS_REALISTAS.length; i < chamadosInseridos.length; i++) {
    const chamadoDb = chamadosInseridos[i];

    // 1 a 2 tags por chamado
    const tag1 = tagsCriadas[i % tagsCriadas.length];
    todosChamadoTags.push({ chamadoId: chamadoDb.id, tagId: tag1.id });

    if (i % 2 === 0) {
      const tag2 = tagsCriadas[(i + 5) % tagsCriadas.length];
      if (tag2.id !== tag1.id) {
        todosChamadoTags.push({ chamadoId: chamadoDb.id, tagId: tag2.id });
      }
    }

    // Comentário inicial em todos os chamados em atendimento/resolvidos
    if (chamadoDb.status !== StatusChamado.ABERTO) {
      const autorAtendenteId =
        chamadoDb.atendenteId ?? atendentes[i % atendentes.length].id;

      todosComentarios.push({
        chamadoId: chamadoDb.id,
        autorId: autorAtendenteId,
        conteudo: `Chamado recebido pela equipe de suporte técnico. Diagnóstico em andamento (${faker.hacker.ingverb()}).`,
        criadoEm: new Date(chamadoDb.criadoEm.getTime() + 30 * 60 * 1000),
      });

      if (
        chamadoDb.status === StatusChamado.RESOLVIDO ||
        chamadoDb.status === StatusChamado.FECHADO
      ) {
        todosComentarios.push({
          chamadoId: chamadoDb.id,
          autorId: chamadoDb.solicitanteId,
          conteudo: 'Testado aqui no setor, o problema foi resolvido. Obrigado pelo suporte!',
          criadoEm: new Date(chamadoDb.criadoEm.getTime() + 120 * 60 * 1000),
        });
      }
    }
  }

  const lotesComentarios = dividirEmLotes(todosComentarios, TAMANHO_LOTE_INSERT);
  const lotesChamadoTags = dividirEmLotes(todosChamadoTags, TAMANHO_LOTE_INSERT);

  await prisma.$transaction([
    ...lotesComentarios.map((lote) => prisma.comentario.createMany({ data: lote })),
    ...lotesChamadoTags.map((lote) =>
      prisma.chamadoTag.createMany({ data: lote, skipDuplicates: true })
    ),
  ]);

  // -------------------------------------------------------------------------
  // 6. Embeddings em lote (somente artigos + chamados realistas resolvidos)
  // -------------------------------------------------------------------------
  const pularEmbeddings =
    opcoes?.pularEmbeddings ??
    (process.argv.includes('--skip-embeddings') ||
      process.env.SEED_SKIP_EMBEDDINGS === 'true');

  let resumoEmbeddings: ResumoReindexacao | null = null;

  if (pularEmbeddings) {
    console.log(
      '⏭️ Geração de embeddings pulada (--skip-embeddings). Execute "npm run reindex" quando desejar gerar os vetores.'
    );
  } else {
    try {
      resumoEmbeddings = await reindexarBaseSemantica({
        limiteArtigos: ARTIGOS_BASE_CONHECIMENTO.length,
        limiteChamados: CHAMADOS_REALISTAS.length,
        tamanhoLote: 20,
        delayMs: 1500,
        limparAntes: true,
      });
    } catch (erroEmbedding: unknown) {
      const msg =
        erroEmbedding instanceof Error ? erroEmbedding.message : String(erroEmbedding);
      console.warn(
        `⚠️ Os dados relacionais foram populados, mas houve falha ao gerar embeddings (${msg}). Você pode rodar "npm run reindex" separadamente.`
      );
    }
  }

  try {
    console.log('\n🔎 Sincronizando chamados com o Elasticsearch (Bulk API)...');
    const resumoElastic = await sincronizarTodosChamadosBulk({
      recriarIndice: true,
      tamanhoLote: 1000,
    });
    console.log(
      `✅ Elasticsearch sincronizado: ${resumoElastic.totalIndexados}/${resumoElastic.totalLidos} chamados no índice "${resumoElastic.indice}" (${resumoElastic.tempoMs}ms).`
    );
  } catch (erroElastic: unknown) {
    const msg =
      erroElastic instanceof Error ? erroElastic.message : String(erroElastic);
    console.warn(
      `⚠️ Não foi possível sincronizar com o Elasticsearch durante o seed (${msg}). Você pode rodar "npm run sync:elastic" separadamente.`
    );
  }

  return {
    categorias: categoriasCriadas.length,
    tags: tagsCriadas.length,
    usuarios: usuariosCriados.length,
    artigos: ARTIGOS_BASE_CONHECIMENTO.length,
    chamados: chamadosInseridos.length,
    chamadosRealistas: CHAMADOS_REALISTAS.length,
    comentarios: todosComentarios.length,
    chamadoTags: todosChamadoTags.length,
    embeddings: resumoEmbeddings,
  };
}

export async function executarSeedCli(): Promise<void> {
  try {
    const resumo: ResumoSeed = await executarSeed();
    console.log('\n✅ Seed finalizado com sucesso!');
    console.table({
      Categorias: resumo.categorias,
      Tags: resumo.tags,
      Usuarios: resumo.usuarios,
      Artigos: resumo.artigos,
      'Chamados (Total)': resumo.chamados,
      'Chamados (Realistas à mão)': resumo.chamadosRealistas,
      Comentarios: resumo.comentarios,
      'Vínculos ChamadoTag': resumo.chamadoTags,
      'Documentos Indexados (pgvector)': resumo.embeddings?.totalDocumentos ?? 0,
    });
  } catch (erro: unknown) {
    console.error('❌ Falha ao executar seed:', erro);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([encerrarEmbeddings(), elasticClient.close()]);
  }
}

if (require.main === module) {
  void executarSeedCli();
}
