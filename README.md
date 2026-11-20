# Projeto DAD - Grupo 37

Projeto da unidade curricular Desenvolvimento de Aplicações Distribuídas (Engenharia Informática, ESTG/IPLeiria, 2026/27).

Para a entrega intermédia estamos a usar o código base dos tutoriais (`ricardogomes/DAD-Tutorials`) já configurado para o grupo `dad-group-37`.

## Estrutura

- `api/` - Backend Laravel (SQLite)
- `frontend/` - Frontend Vue
- `websockets/` - Servidor WebSockets (Node.js + Socket.IO)
- `deployment/` - Dockerfiles e ficheiros Kubernetes
- `justfile` - Comandos de build/push/deploy (opcional)
- `setupEntregaIntermedia.md` - Passos para o deploy da entrega intermédia

## URLs em produção (VPN/Intranet ESTG)

- Frontend: http://web-dad-group-37-172.22.21.253.sslip.io
- API: http://api-dad-group-37-172.22.21.253.sslip.io
- WebSockets: http://ws-dad-group-37-172.22.21.253.sslip.io

## Correr localmente

Requisitos: PHP 8.5 + Composer e Node.js 24 (24.12+).

Backend (`http://localhost:8000`):
```bash
cd api
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan serve
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

WebSockets (`http://localhost:3000`):
```bash
cd websockets
npm install
npm run dev
```

Contas de teste (password: `password`): `test@example.com` e `second@example.com`.
