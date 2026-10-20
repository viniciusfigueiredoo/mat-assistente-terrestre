# Projeto DLEI 2026

## Documento de Especificação de Requisitos

**Produto:** Módulo Assistente Terrestre (MAT) & Aplicativo Companheiro • **Alinhamento:** ODS 3 (ONU Agenda 2030) • **Data:** Outubro de 2026

---

## 1. Introdução

### 1.1. Objetivo

Inicialmente, a especificação segue o 3º dos 17 Objetivos de Desenvolvimento Sustentável da ONU da agenda de 2030, *"Saúde e bem-estar: Assegurar uma vida saudável e promover o bem-estar para todas e todos, em todas as idades"*.

Dessa forma, o objetivo do projeto é desenvolver um módulo inteligente, que, ao ser acoplado ao OLC, permita o mapeamento do terreno, enviando informações como existência de buracos e escadas, vibrando o equipamento caso positivo ou reproduzindo a voz no aplicativo. Ademais, para se conectar ao módulo, um aplicativo será desenvolvido com o objetivo de gerar rotas para o usuário via comando de voz, permitindo a ativação da rota por meio do deslizar do dedo para a esquerda ou direita, indicando, respectivamente, confirmação ou negação da rota.

O objetivo deste documento de Especificação de Requisitos de Software (ERS) é definir de maneira clara, completa e consistente as funcionalidades, interfaces, atributos de qualidade e restrições técnicas tanto do firmware embarcado no módulo acoplável quanto do aplicativo móvel companheiro. Os leitores previstos para este documento incluem: (i) a equipe de desenvolvimento de hardware e software do Projeto DLEI 2026, que o utilizará como referência direta de projeto e implementação; (ii) os responsáveis pelos testes e validação do protótipo; e (iii) os professores orientadores, avaliadores acadêmicos e demais partes interessadas que acompanham a evolução do sistema.

### 1.2. Escopo

O produto a ser desenvolvido denomina-se **Módulo Assistente Terrestre (MAT)**, operando em conjunto com seu aplicativo móvel companheiro (**App MAT**). O sistema compõe uma solução integrada de tecnologia assistiva voltada à mobilidade segura e independente de pessoas com deficiência visual. Abaixo estão detalhados a identificação do produto, suas fronteiras de atuação, seus benefícios e sua consistência com especificações de alto nível:

- **Identificação do Produto - Módulo Assistente Terrestre (MAT) e App MAT:** Sistema composto por um dispositivo eletrônico acoplável à bengala longa (objeto principal de locomoção do usuário) dotado de sensores de mapeamento e atuador vibratório, integrado via Bluetooth a um aplicativo móvel de navegação guiada por voz e gestos.
- **O que o produto vai fazer (Escopo Incluído):** O módulo vai mapear o terreno no qual o deficiente visual anda, lendo escadas, buracos e paredes à frente, alertando o usuário em tempo real através do aplicativo (alerta sonoro/voz) ou da vibração direta do módulo. O aplicativo móvel permitirá solicitar destinos por comando de voz, calculará a rota de caminhada e permitirá ativar ou cancelar a rota deslizando o dedo na tela para a esquerda (confirmação) ou para a direita (negação).
- **O que o produto não vai fazer (Escopo Excluído):** O módulo não mapeia o terreno em todas as direções (360°), realizando a leitura exclusivamente para baixo (solo imediato à frente para detecção de buracos e desníveis) e para a frente do usuário (escadas e paredes). Além disso, o sistema não substitui a função tátil mecânica da bengala nem realiza condução motorizada autônoma, atuando como um sistema complementar de alerta antecipado e orientação espacial.
- **Benefícios, Objetivos e Metas da Aplicação:** A aplicação de hardware e software presente beneficiará diretamente pessoas com deficiência visual total ou baixa visão severa ao reduzir acidentes causados por desníveis abruptos (buracos e degraus) e colisões com obstáculos frontais em locais de difícil acesso e locomoção. As metas principais consistem em fornecer alertas hápticos imediatos (tempo de resposta inferior a 150 ms) e proporcionar uma interface móvel 100% operável sem o uso da visão, ampliando a confiança, a autonomia e a inclusão social do usuário em deslocamentos diários.
- **Consistência com Especificações de Alto Nível:** O projeto mantém total aderência ao 3º Objetivo de Desenvolvimento Sustentável (ODS 3 - Saúde e Bem-Estar) da Agenda 2030 da ONU, bem como às diretrizes internacionais de acessibilidade digital e desenho universal.

### 1.3. Definições, acrônimos e abreviações

Para garantir a compreensão desta especificação por todos os envolvidos no projeto, a tabela a seguir reúne os termos técnicos, acrônimos e abreviações adotados ao longo do documento:

| Termo / Sigla | Significado | Definição no Contexto do Projeto |
| :--- | :--- | :--- |
| **MAT** | Módulo Assistente Terrestre | Dispositivo eletrônico acoplado à bengala do usuário, responsável pela leitura de sensores do terreno e alerta vibratório. |
| **OLC** | Objeto de Locomoção do Cego | Objeto que o deficiente visual utiliza por preferência (bengalas, bengalas inteligentes, bengalas com ponteiras). |
| **App MAT** | Aplicativo Móvel Companheiro | Software para smartphone que se conecta ao MAT via Bluetooth, provendo rotas por comando de voz e interação por gestos. |
| **ODS 3** | Objetivo de Desenvolvimento Sustentável 3 | Meta da Agenda 2030 da ONU focada em assegurar uma vida saudável e promover o bem-estar para todos, em todas as idades. |
| **ERS / SRS** | Especificação de Requisitos de Software | Documento técnico que descreve os requisitos funcionais, não-funcionais, interfaces e restrições do sistema. |
| **BLE** | Bluetooth Low Energy | Tecnologia de comunicação sem fio de baixo consumo energético utilizada na troca de dados entre o módulo MAT e o smartphone. |
| **STT** | Speech-to-Text (Voz para Texto) | Motor de reconhecimento de fala utilizado pelo aplicativo para converter o destino falado pelo usuário em texto pesquisável. |
| **TTS** | Text-to-Speech (Texto para Voz) | Motor de síntese de voz utilizado pelo aplicativo para narrar rotas, confirmações e alertas sonoros ao usuário. |
| **ToF / Ultrassom** | Time-of-Flight / Sensor Ultrassônico | Sensores de medição de distância por tempo de voo (laser/infravermelho ou ondas ultrassônicas) para detectar buracos, escadas e paredes. |
| **Feedback Háptico** | Resposta Tátil / Vibração | Estímulo mecânico vibratório emitido pelo módulo MAT na bengala para alertar o usuário sobre perigos no terreno. |
| **RF / RNF** | Requisito Funcional / Não-Funcional | Identificadores utilizados para catalogar as funcionalidades do sistema (RF) e seus atributos de qualidade (RNF). |

*Os termos definidos acima são empregados de forma padronizada nas descrições de requisitos da Seção 2.*

### 1.4. Referências

Esta subseção apresenta a lista completa dos documentos, normas técnicas e diretrizes referenciados na elaboração desta especificação, identificando autores, títulos, datas e fontes de obtenção:

- **[1] G. Kotonya e I. Sommerville.** Requirements Engineering – Processes and Techniques. Editora John Wiley and Sons, 2002. Fonte: Bibliografia base do modelo de engenharia de requisitos (IC-UNICAMP).
- **[2] IEEE Computer Society.** IEEE Std 830-1998: IEEE Recommended Practice for Software Requirements Specifications. Institute of Electrical and Electronics Engineers, 1998. Fonte: [IEEE Xplore Digital Library](https://ieeexplore.ieee.org/document/720574)
- **[3] A. Carvalho e Profa. Cecília M. F. Rubira.** Modelo de Documento de Especificação de Requisitos. Instituto de Computação – UNICAMP. Fonte: Material didático da disciplina de Engenharia de Software (IC-UNICAMP).
- **[4] W. P. P. Filho.** Engenharia de Software – Fundamentos, Métodos e Padrões. 2ª edição, Editora LTC, 2003. Fonte: Acervo bibliográfico de Engenharia de Software (Capítulo 5).
- **[5] Organização das Nações Unidas (ONU).** Transformando Nosso Mundo: A Agenda 2030 para o Desenvolvimento Sustentável (Objetivo 3: Saúde e Bem-Estar). Nações Unidas Brasil, 2015. Fonte: [Portal ODS ONU Brasil](https://brasil.un.org/pt-br/sdgs/3)
- **[6] World Wide Web Consortium (W3C).** Web Content Accessibility Guidelines (WCAG) 2.1 & Mobile Accessibility Guidelines. W3C Recommendation, 2018. Fonte: W3C Accessibility Standards.

### 1.5. Visão geral

O restante deste documento de especificação de requisitos está organizado em mais duas seções principais, estruturadas conforme o modelo adotado para garantir rastreabilidade e clareza técnica:

- **Seção 2 — Descrição Geral:** Apresenta o detalhamento técnico do produto dividido em seis subseções: Requisitos Funcionais (2.1), contendo todas as funções do módulo MAT e do aplicativo classificadas como obrigatórias, desejáveis ou opcionais; Requisitos de Interface (2.2), especificando a interação com o usuário, com o hardware, com outros sistemas e trazendo o esboço obrigatório das telas do aplicativo; Atributos de Qualidade (2.3), definindo metas de desempenho, latência, confiabilidade e usabilidade com suas prioridades; Características dos Usuários (2.4), traçando o perfil educacional e técnico do público-alvo; Restrições (2.5), listando limitações físicas, operacionais e de implementação; e Suposições e Dependências (2.6), abordando fatores externos que impactam os requisitos.
- **Seção 3 — Anexo e Referências Consolidada:** Documenta os recursos, metodologias e técnicas empregados na extração dos requisitos, o questionário aplicado no levantamento das necessidades de mobilidade e os dados de contato dos participantes e responsáveis pelo projeto.

---

## 2. Descrição Geral

### 2.1. Requisitos funcionais

Os requisitos funcionais descrevem os comportamentos e serviços que o sistema (Firmware Embarcado do Módulo MAT e Aplicativo Móvel Companheiro) deve prover. Cada requisito foi classificado quanto à sua prioridade em três níveis: **Obrigatório** (essencial para o funcionamento básico e segurança do usuário no MVP), **Desejável** (agrega valor significativo à experiência e usabilidade, devendo ser implementado caso haja recursos dentro do cronograma) ou **Opcional** (funcionalidade complementar para evoluções futuras).

| ID | Módulo | Descrição do Requisito Funcional | Classificação |
| :--- | :--- | :--- | :--- |
| **RF01** | Módulo MAT | O módulo deve monitorar continuamente o solo imediatamente à frente da bengala (direção inferior) para detectar buracos, depressões ou desníveis descendentes. | Obrigatório |
| **RF02** | Módulo MAT | O módulo deve identificar a presença de escadas (degraus ascendentes ou descendentes) na trajetória frontal e inferior do usuário. | Obrigatório |
| **RF03** | Módulo MAT | O módulo deve detectar paredes e obstáculos físicos posicionados à frente do usuário dentro do raio de alcance seguro de caminhada (ex.: 0,3 m a 2,5 m). | Obrigatório |
| **RF04** | Módulo MAT | O módulo deve acionar imediatamente seu atuador de vibração (feedback háptico) sempre que um buraco, escada ou parede frontal for detectado. | Obrigatório |
| **RF05** | Módulo MAT | O módulo deve modular o padrão de vibração (ex.: vibração contínua intensa para buracos/escadas e pulsos rápidos para paredes à frente) para diferenciar a natureza do risco. | Desejável |
| **RF06** | Módulo MAT | O módulo deve operar seu mapeamento e alerta vibratório de forma autônoma (modo standalone) mesmo quando não houver conexão ativa com o smartphone. | Obrigatório |
| **RF07** | MAT / App | O módulo deve transmitir via Bluetooth (BLE) os eventos de obstáculos detectados (buraco, escada, parede) e o status de bateria para o aplicativo móvel. | Obrigatório |
| **RF08** | App Móvel | O aplicativo deve permitir ao usuário solicitar uma rota de navegação informando o endereço ou ponto de interesse por meio de comando de voz (STT). | Obrigatório |
| **RF09** | App Móvel | Após processar o comando de voz e calcular o trajeto, o aplicativo deve narrar (via TTS) o resumo da rota (destino reconhecido, distância e tempo estimado) e solicitar confirmação. | Obrigatório |
| **RF10** | App Móvel | O aplicativo deve confirmar e iniciar a rota gerada quando o usuário realizar o gesto de deslizar o dedo para a esquerda (*swipe left*) na tela do smartphone. | Obrigatório |
| **RF11** | App Móvel | O aplicativo deve negar e cancelar a rota sugerida quando o usuário realizar o gesto de deslizar o dedo para a direita (*swipe right*) na tela, retornando ao modo de escuta de voz. | Obrigatório |
| **RF12** | App Móvel | Durante a navegação ativa, o aplicativo deve fornecer instruções passo a passo por voz (TTS) e emitir alertas auditivos específicos quando o módulo MAT reportar buracos, escadas ou paredes. | Obrigatório |
| **RF13** | App Móvel | O aplicativo deve realizar o pareamento e a reconexão automática com o módulo MAT cadastrado sempre que ambos estiverem ligados e dentro do alcance Bluetooth. | Desejável |
| **RF14** | App Móvel | O aplicativo deve permitir salvar destinos favoritos acionáveis por comandos rápidos de voz (ex.: "Ir para casa", "Ir para a universidade"). | Opcional |

> **Legenda de Prioridades:** **Verde (Obrigatório)** - Essencial para operação e segurança | **Amarelo (Desejável)** - Importante para usabilidade | **Azul (Opcional)** - Possível evolução futura

### 2.2. Requisitos de interface

A arquitetura do sistema MAT envolve interações diretas com o usuário deficiente visual, com os componentes eletrônicos do hardware embarcado e com sistemas externos de geolocalização e voz. A seguir são detalhadas cada uma dessas interfaces e apresentados os esboços das telas referentes às principais funcionalidades do produto:

- **Interface com as Pessoas (Interface de Usuário — UI/UX Acessível):** Projetada sob o paradigma *eyes-free* (uso sem necessidade de visualização da tela). A entrada de dados ocorre por comando de voz para ditar o destino e por dois gestos táteis globais que ocupam toda a área útil da tela do celular: deslizar o dedo para a esquerda (confirma e inicia a rota) e deslizar o dedo para a direita (nega ou cancela a rota). A saída de informações para o usuário ocorre por síntese de voz (TTS) no smartphone e por vibração mecânica (feedback háptico) no módulo MAT acoplado à bengala. Para usuários com baixa visão residual ou acompanhantes, a tela exibe elementos em alto contraste e tipografia ampliada.
- **Interface com o Hardware do Sistema:** O firmware embarcado no microcontrolador do módulo MAT comunica-se diretamente com: (i) dois conjuntos de sensores de distância (ultrassônicos e/ou ópticos Time-of-Flight via barramentos digitais I2C/GPIO), sendo um direcionado em ângulo inferior para varredura de buracos e degraus no solo e outro direcionado horizontalmente à frente para detecção de paredes e obstáculos; (ii) um módulo motor de vibração acionado via sinal PWM (modulação por largura de pulso) para controle de intensidade e frequência; (iii) o transceptor integrado Bluetooth Low Energy (BLE); e (iv) o circuito de alimentação e leitura de tensão da bateria recarregável.
- **Interface com Outros Sistemas e Produtos (Software e APIs):** O aplicativo móvel interage com o sistema operacional do smartphone (Android / iOS) através da pilha nativa Bluetooth GATT para leitura de pacotes de telemetria do MAT, dos serviços nativos de localização (GPS/GNSS), das APIs de reconhecimento de fala (SpeechRecognizer / Speech Framework) e síntese de voz (TextToSpeech), além de consumir serviços externos de roteamento para pedestres (Google Maps Directions API ou OSRM/OpenStreetMap) via requisições HTTPS REST.
- **Esboço Obrigatório das Telas Principais do Produto:** O fluxo do aplicativo móvel concentra-se em três telas essenciais de altíssimo contraste e operação por voz/gestos: (1) Tela Inicial de Pareamento e Comando de Voz, que informa o status de conexão com o módulo MAT e aguarda o comando falado de destino; (2) Tela de Confirmação de Rota por Gestos, na qual o usuário desliza o dedo para a esquerda para confirmar a rota narrada ou para a direita para negá-la; e (3) Tela de Navegação Ativa e Alertas do Terreno, que conduz o usuário passo a passo e exibe/narra os alertas de escadas, buracos e paredes recebidos do módulo MAT.

### 2.3. Atributos de qualidade

Por tratar-se de um sistema crítico de auxílio à locomoção e prevenção de acidentes para pessoas com deficiência visual, o desempenho em tempo real, a confiabilidade e a acessibilidade constituem requisitos determinantes para a qualidade do produto. A tabela abaixo especifica os requisitos não-funcionais (atributos de qualidade), suas métricas de verificação e sua classificação de prioridade. Todos os atributos classificados como obrigatórios serão validados em testes de bancada e ensaios de caminhada controlada antes da liberação do protótipo final.

| ID | Atributo de Qualidade | Especificação e Métrica Desejada | Prioridade |
| :--- | :--- | :--- | :--- |
| **RNF01** | Desempenho (Tempo de Resposta Local) | O tempo total entre a detecção física de um buraco, escada ou parede pelos sensores e o acionamento da vibração no módulo MAT deve ser inferior a 150 ms, garantindo tempo hábil de reação durante a caminhada. | Obrigatório |
| **RNF02** | Desempenho (Latência de Comunicação) | A transmissão do evento de obstáculo do módulo MAT para o smartphone via Bluetooth (BLE) deve apresentar latência máxima de 300 ms. | Obrigatório |
| **RNF03** | Desempenho (Cálculo de Rota e Voz) | O processamento do comando de voz e o início da narração da rota sugerida pelo aplicativo devem ocorrer em até 3 segundos sob conexão de rede estável. | Desejável |
| **RNF04** | Usabilidade e Acessibilidade | 100% das funcionalidades do aplicativo devem ser operáveis sem apoio visual (*eyes-free*). Os gestos de confirmação (deslizar à esquerda) e negação (deslizar à direita) devem ser reconhecidos em qualquer ponto da tela, sem exigir toque em botões pequenos. | Obrigatório |
| **RNF05** | Confiabilidade e Tolerância a Falhas | A função de mapeamento do terreno e alerta vibratório do módulo MAT não pode depender do funcionamento do aplicativo móvel; em caso de falha ou desconexão do celular, o módulo deve manter a proteção local ativa continuamente. | Obrigatório |
| **RNF06** | Eficiência Energética (Autonomia) | A bateria do módulo MAT deve proporcionar autonomia mínima de 6 a 8 horas de operação contínua com uma única recarga. | Desejável |
| **RNF07** | Portabilidade | O aplicativo móvel deve ser desenvolvido utilizando tecnologia multiplataforma ou compatível com os sistemas operacionais Android (10.0+) e iOS (15.0+). | Desejável |
| **RNF08** | Manutenibilidade | O código do firmware e do aplicativo deve ser modularizado em camadas (leitura de sensores, lógica de decisão, comunicação BLE e interface de voz/gestos), facilitando calibrações de sensibilidade e manutenções futuras. | Opcional |

### 2.4. Características dos usuários

O projeto considera dois perfis de usuários distintos, cujas características educacionais, experiências prévias e conhecimentos técnicos moldam diretamente as decisões de interface do produto:

- **Usuário Primário — Pessoa com Deficiência Visual (Cego ou Baixa Visão):** Abrange jovens, adultos e idosos que utilizam a bengala de orientação e mobilidade no dia a dia. O nível educacional é amplo e heterogêneo (desde alfabetização básica até ensino superior completo), motivo pelo qual o vocabulário das instruções de voz deve ser direto, natural e livre de jargões técnicos. Quanto à experiência tecnológica, os usuários costumam possuir familiaridade básica com smartphones e assistentes de voz, mas enfrentam barreiras severas em aplicativos com muitos botões ou menus complexos — o que justifica a escolha de interação exclusiva por comando de voz e gestos simples de deslizar para a esquerda ou direita. Não é exigido nenhum conhecimento técnico em hardware ou informática.
- **Usuário Secundário — Familiar, Cuidador ou Instrutor de Orientação e Mobilidade:** Pessoas que eventualmente auxiliam o usuário primário no acoplamento físico inicial do módulo MAT na bengala ou na configuração do primeiro pareamento Bluetooth no smartphone. Possuem conhecimento técnico de usuário comum de dispositivos móveis e nível educacional geral.

### 2.5. Restrições

O desenvolvimento e a operação do Módulo Assistente Terrestre (MAT) e de seu aplicativo estão sujeitos às seguintes restrições técnicas, físicas e operacionais:

- **Limites Físicos de Peso e Dimensão (Ergonomia na Bengala):** Por ser acoplado ao objeto principal de locomoção (bengala), o módulo MAT deve possuir peso reduzido (meta inferior a 150 g) e fixação firme para não comprometer o balanço pendular da bengala nem gerar esforço repetitivo no punho do usuário.
- **Limites de Recursos de Hardware Embarcado:** O microcontrolador do módulo opera com memória RAM, armazenamento Flash e capacidade de processamento restritos, além de alimentação por bateria compacta, exigindo código embarcado otimizado em C/C++ sem dependência de processamento pesado em nuvem para a detecção de obstáculos.
- **Restrições Geométricas de Sensoriamento:** Conforme definido no escopo, os sensores possuem cones de leitura direcionados apenas para baixo e para a frente; objetos laterais fora do feixe de leitura ou obstáculos suspensos acima da linha do peito/cabeça que não interceptem o feixe frontal não são cobertos pelo módulo.
- **Ambientes Operacionais e Ruído:** O sistema operará em ambientes urbanos abertos e internos sujeitos a trepidação constante, variações de luminosidade solar e ruído acústico de trânsito (o que impõe o uso de filtros de voz no aplicativo e a obrigatoriedade do alerta vibratório no módulo como canal primário de segurança).
- **Padrões e Linguagens de Implementação:** A comunicação sem fio é restrita ao padrão Bluetooth Low Energy (BLE) para compatibilidade universal com smartphones modernos e baixo consumo energético.

### 2.6. Suposições e dependências

Os fatores listados a seguir não são restrições diretas de projeto, mas representam suposições e dependências externas cujas mudanças podem afetar os requisitos desta especificação:

- **Disponibilidade de Smartphone e Conectividade de Rede:** Supõe-se que o usuário utilize um smartphone com Bluetooth, GPS e conexão ativa com a internet (dados móveis) para o cálculo de novas rotas e reconhecimento de voz em nuvem. Caso o sistema operacional ou o aparelho não disponha de conexão à internet no momento da caminhada, os requisitos de geração de rota (RF08-RF12) poderão exigir pacotes de mapas e voz offline.
- **Dependência de APIs Externas de Mapas e Voz:** A precisão das rotas geradas para pedestres depende diretamente da atualização cartográfica da API de mapas utilizada (ex.: Google Maps / OpenStreetMap) e dos motores de STT/TTS do sistema operacional móvel.
- **Posicionamento e Acoplamento Correto na Bengala:** Assume-se que o módulo MAT será acoplado à bengala na altura e inclinação especificadas no manual de uso. Mudanças drásticas na postura de empunhadura ou o acoplamento em objetos de locomoção com geometria muito distinta (como andadores) podem alterar o ângulo de incidência no solo e demandar ajustes nos requisitos de calibração dos sensores.
- **Permissões do Sistema Operacional:** O funcionamento completo do aplicativo depende da concessão prévia de permissões de acesso à localização (GPS), ao microfone e ao Bluetooth no sistema operacional do smartphone.

---

## 3. Anexo

Esta seção documenta os recursos metodológicos e as técnicas empregadas para a extração e definição dos requisitos do sistema MAT, bem como as questões norteadoras levantadas e os registros de contato dos envolvidos.

### 3.1. Recursos e técnicas utilizados para a extração de requisitos

- **Análise de Domínio Orientada à Agenda 2030 (ODS 3):** Estudo das diretrizes da ONU para Saúde e Bem-Estar visando identificar barreiras reais de acessibilidade e segurança enfrentadas por pessoas com deficiência visual no espaço urbano.
- **Brainstorming e Prototipação de Interação Eyes-Free:** Sessões de concepção pela equipe do Projeto DLEI 2026 para substituir interfaces visuais complexas por comandos de voz e gestos direcionais simples (deslizar para esquerda = confirmar rota; deslizar para direita = negar rota).
- **Análise de Tarefas e Cenários de Uso:** Mapeamento dos cenários críticos de caminhada com bengala longa (aproximação de escadas, buracos na calçada e paredes à frente) para determinar as direções prioritárias de leitura dos sensores (para baixo e para a frente) e a resposta vibratória imediata.

### 3.2. Questões formuladas para elicitação e validação de requisitos

As seguintes questões nortearam o levantamento dos requisitos funcionais, de interface e de qualidade do produto:

- **Q1:** Quais são os obstáculos físicos mais frequentes e perigosos durante a locomoção diária que uma bengala convencional demora a identificar com antecedência? *(Resposta associada: Buracos bruscos, início de escadas e paredes/obstáculos frontais -> originou RF01, RF02 e RF03).*
- **Q2:** Qual é a forma mais segura e imediata de alertar o usuário sobre um obstáculo mesmo em ambientes urbanos barulhentos? *(Resposta associada: Vibração física diretamente no equipamento acoplado à bengala combinada ao alerta no aplicativo -> originou RF04, RF05 e RNF01).*
- **Q3:** Como uma pessoa cega pode solicitar e confirmar uma rota no celular caminhando na rua sem precisar procurar botões na tela? *(Resposta associada: Solicitação via comando de voz e confirmação/negação pelo deslizar do dedo para a esquerda ou direita em qualquer parte da tela -> originou RF08, RF09, RF10, RF11 e RNF04).*
- **Q4:** O que deve acontecer caso o celular descarregue ou perca a conexão Bluetooth com o módulo durante a caminhada? *(Resposta associada: O módulo deve continuar vibrando de forma independente ao detectar buracos e escadas -> originou RF06 e RNF05).*

### 3.3. Pessoas, instituições e dados de contato

A tabela a seguir registra os responsáveis pelo levantamento inicial de requisitos, instituições vinculadas e canais de contato do projeto:

| Nome / Papel no Projeto | Empresa / Instituição | Telefone / E-mail de Contato | Data de Contato |
| :--- | :--- | :--- | :--- |
| **Vinícius Figueiredo de Q. Almeida** (Autor / Especificação de Requisitos) | Projeto DLEI 2026 | viniciusqalmeida96@gmail.com | 17/10/2026 |
| **Equipe de Desenvolvimento de Hardware & Software MAT** | Projeto DLEI 2026 | Contato interno da equipe DLEI 2026 | Outubro/2026 |

---

## Referências

- **[1]** G. Kotonya e I. Sommerville. Requirements engineering – processes and techniques. Editora John Wiley and Sons – 2002.
- **[2]** IEEE 830-1998 Recommended Practice for Software Requirements Specification [https://ieeexplore.ieee.org/document/720574]
- **[3]** A. Carvalho. Documento de especificação de requisitos [http://www.ic.unicamp.br/~ariadne/inf301/modulo2-v.pdf]
- **[4]** W. P. P. Filho. Engenharia de software – fundamentos, métodos e padrões. 2ª ed. Editora LTC – 2003.
- **[5]** Organização das Nações Unidas (ONU). Agenda 2030 – Objetivo de Desenvolvimento Sustentável 3 (Saúde e Bem-Estar) [https://brasil.un.org/pt-br/sdgs/3]
