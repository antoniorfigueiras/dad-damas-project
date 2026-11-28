<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\MatchController;
use App\Http\Controllers\StatisticsController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\WsGameController;
use App\Http\Middleware\VerifyWsToken;
use Illuminate\Support\Facades\Route;

// Rotas públicas
Route::post('/login', [AuthController::class, 'login']);
Route::post('/register', [AuthController::class, 'register']);
Route::get('/statistics', [StatisticsController::class, 'summary']);
Route::get('/leaderboards', [StatisticsController::class, 'leaderboards']);

// Integração interna servidor WebSocket -> API
Route::post('/ws/games', [WsGameController::class, 'store'])->middleware(VerifyWsToken::class);

// Rotas autenticadas (Sanctum)
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);

    // Perfil do utilizador autenticado
    Route::get('/users/me', [UserController::class, 'me']);
    Route::get('/users/me/statistics', [StatisticsController::class, 'myStatistics']);
    Route::put('/users/me', [UserController::class, 'update']);
    Route::delete('/users/me', [UserController::class, 'destroy']);

    // Jogos (Damas)
    Route::get('/games', [GameController::class, 'index']);
    Route::post('/games', [GameController::class, 'store']);
    Route::get('/games/{game}', [GameController::class, 'show']);
    Route::patch('/games/{game}', [GameController::class, 'update']);

    // Partidas (Matches)
    Route::get('/matches', [MatchController::class, 'index']);
    Route::post('/matches', [MatchController::class, 'store']);
    Route::get('/matches/{match}', [MatchController::class, 'show']);
    Route::patch('/matches/{match}', [MatchController::class, 'update']);
});
