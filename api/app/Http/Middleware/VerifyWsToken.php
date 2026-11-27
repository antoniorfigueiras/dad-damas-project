<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyWsToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.ws.token');

        if ($expected === '') {
            return response()->json([
                'message' => 'Token de integração WebSocket não configurado.',
            ], 503);
        }

        $provided = (string) $request->bearerToken();

        if ($provided === '' || ! hash_equals($expected, $provided)) {
            return response()->json([
                'message' => 'Não autorizado.',
            ], 401);
        }

        return $next($request);
    }
}
