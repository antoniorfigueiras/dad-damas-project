# Setup da Entrega Intermédia (dad-group-37)

Notas para fazer o deploy no cluster Kubernetes da ESTG (baseado nos tutoriais da cadeira).
Os ficheiros em `deployment/`, `justfile` e `frontend/.env.production` já estão alterados para `dad-group-37`.

## 1. Pré-requisitos

- Estar na rede da ESTG ou ligado à VPN do IPLeiria
- Ter Docker Desktop e `kubectl` (v1.35, 1.36 ou 1.37)
- Colocar o ficheiro de config recebido por email em `~/.kube/config` (sem `.yml`) e testar:
  ```bash
  kubectl get pods
  ```
- No Docker Desktop (Settings > Docker Engine), adicionar o registry inseguro e reiniciar:
  ```json
  "insecure-registries": ["registry-172.22.21.115.sslip.io"]
  ```

## 2. Clonar e criar `api/.env.production`

```bash
git clone https://github.com/antoniorfigueiras/dad-damas-project.git
cd dad-damas-project
```

Criar o ficheiro `api/.env.production` (não está no git por causa do `.gitignore`):
```ini
APP_KEY=<output de php artisan key:generate --show>
APP_DEBUG=false
APP_URL=http://api-dad-group-37-172.22.21.253.sslip.io
```

Para gerar a chave (dentro da pasta `api/`):
```bash
php artisan key:generate --show
```

## 3. Build e push das imagens (v1.0.0)

Na raiz do projeto:

```bash
docker build -t registry-172.22.21.115.sslip.io/dad-group-37/api:v1.0.0 --platform linux/amd64 -f ./deployment/DockerfileLaravel ./api
docker push registry-172.22.21.115.sslip.io/dad-group-37/api:v1.0.0

docker build -t registry-172.22.21.115.sslip.io/dad-group-37/web:v1.0.0 --platform linux/amd64 -f ./deployment/DockerfileVue ./frontend
docker push registry-172.22.21.115.sslip.io/dad-group-37/web:v1.0.0

docker build -t registry-172.22.21.115.sslip.io/dad-group-37/ws:v1.0.0 --platform linux/amd64 -f ./deployment/DockerfileWS ./websockets
docker push registry-172.22.21.115.sslip.io/dad-group-37/ws:v1.0.0
```

(Com `just`: `just laravel-build`, `just laravel-push`, `just vue-build`, `just vue-push`, `just ws-build`, `just ws-push`.)

## 4. Deploy no Kubernetes

```bash
kubectl apply -f deployment/
kubectl get pods
```

Esperar até os pods ficarem `1/1`.

## 5. Criar base de dados SQLite no pod do Laravel

```bash
kubectl -n dad-group-37 get pods -l app=laravel-app
kubectl -n dad-group-37 exec -it <nome-do-pod-laravel> -- php artisan migrate:fresh --seed --force
```

Nota: sempre que o pod do Laravel for recriado, a BD SQLite perde os dados e é preciso voltar a correr este comando.

## 6. Testar no Google Chrome

1. Abrir http://web-dad-group-37-172.22.21.253.sslip.io
2. Em Laravel Test, fazer login com `test@example.com` / `password`
3. Ir pelo menu (sem reload) a WebSockets Test e confirmar `Connected`
4. Abrir janela anónima, entrar com `second@example.com` / `password` e mandar mensagem entre os dois

## 7. Entrega no Moodle

- Deixar a plataforma a correr no cluster
- Submeter o ficheiro `grp_intermediate_report_37.xlsx` no Moodle

## Troubleshooting rápido

- `kubectl` a ligar a `127.0.0.1`: confirmar se o ficheiro é `~/.kube/config` (sem `.yml`) ou usar `KUBECONFIG=~/.kube/config`
- `kubectl` com timeout no WSL: copiar `.kube` para `C:\Users\<user>\.kube` e correr `kubectl` fora do WSL
- `docker push` a tentar HTTPS: no Docker Desktop (Settings > General), desativar a opção de containerd para imagens
- Ver logs: `kubectl logs <nome-do-pod>`
- Reiniciar deployments: `kubectl -n dad-group-37 rollout restart deployment/laravel-app` (igual para `vue-app` e `websocket-server`)
