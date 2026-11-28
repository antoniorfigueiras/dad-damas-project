<?php

use App\Models\Game;
use App\Models\GameMatch;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('registo, login, perfil e logout funcionam corretamente', function () {
    $register = $this->postJson('/api/register', [
        'name' => 'Ana Silva',
        'email' => 'ana@example.com',
        'nickname' => 'anasilva',
        'password' => 'secret123',
        'password_confirmation' => 'secret123',
    ]);

    $register->assertCreated()
        ->assertJsonPath('user.email', 'ana@example.com')
        ->assertJsonStructure(['user', 'token']);

    $token = $register->json('token');

    $this->withToken($token)
        ->getJson('/api/users/me')
        ->assertOk()
        ->assertJsonPath('nickname', 'anasilva');

    $this->withToken($token)
        ->putJson('/api/users/me', ['name' => 'Ana Maria Silva'])
        ->assertOk()
        ->assertJsonPath('name', 'Ana Maria Silva');

    $this->withToken($token)
        ->postJson('/api/logout')
        ->assertOk()
        ->assertJsonPath('message', 'Sessão terminada com sucesso.');
});

test('utilizador bloqueado não consegue fazer login', function () {
    User::factory()->create([
        'email' => 'bloqueado@example.com',
        'password' => 'password',
        'blocked' => true,
    ]);

    $this->postJson('/api/login', [
        'email' => 'bloqueado@example.com',
        'password' => 'password',
    ])->assertForbidden()
        ->assertJsonPath('message', 'A conta encontra-se bloqueada.');
});

test('CRUD básico de jogos e partidas funciona para utilizadores autenticados', function () {
    $p1 = User::factory()->create(['nickname' => 'jog1']);
    $p2 = User::factory()->create(['nickname' => 'jog2']);

    $matchRes = $this->actingAs($p1)->postJson('/api/matches', [
        'type' => 'Rapid',
        'opening_type' => '2-move',
        'player1_user_id' => $p1->id,
        'player2_user_id' => $p2->id,
    ])->assertCreated();

    $matchId = $matchRes->json('id');

    $gameRes = $this->actingAs($p1)->postJson('/api/games', [
        'type' => 'Rapid',
        'opening_type' => '2-move',
        'player1_user_id' => $p1->id,
        'player2_user_id' => $p2->id,
        'match_id' => $matchId,
    ])->assertCreated();

    $gameId = $gameRes->json('id');

    $this->actingAs($p1)->patchJson("/api/games/{$gameId}", [
        'status' => 'Ended',
        'winner_user_id' => $p1->id,
        'loser_user_id' => $p2->id,
        'end_reason' => 'CaptureAll',
        'player1_captures' => 12,
        'player2_captures' => 5,
        'total_moves' => 38,
        'moves_notation' => ['9-13', '21-17'],
    ])->assertOk()
        ->assertJsonPath('winner_user_id', $p1->id)
        ->assertJsonPath('player1_captures', 12);

    $this->actingAs($p1)->getJson('/api/games?mine=1')
        ->assertOk()
        ->assertJsonCount(1, 'data');
});

test('endpoint interno POST /api/ws/games exige token WS válido e guarda jogo', function () {
    config()->set('services.ws.token', 'segredo-teste-ws');

    $p1 = User::factory()->create();
    $p2 = User::factory()->create();

    $payload = [
        'type' => 'Blitz',
        'opening_type' => 'Free',
        'player1_user_id' => $p1->id,
        'player2_user_id' => $p2->id,
        'is_draw' => false,
        'winner_user_id' => $p1->id,
        'loser_user_id' => $p2->id,
        'status' => 'Ended',
        'end_reason' => 'Resignation',
        'player1_captures' => 7,
        'player2_captures' => 4,
        'total_moves' => 24,
        'moves_notation' => ['10-14', '23-19', '14x23'],
    ];

    $this->postJson('/api/ws/games', $payload)->assertUnauthorized();

    $this->withToken('token-errado')
        ->postJson('/api/ws/games', $payload)
        ->assertUnauthorized();

    $this->withToken('segredo-teste-ws')
        ->postJson('/api/ws/games', $payload)
        ->assertCreated()
        ->assertJsonPath('type', 'Blitz')
        ->assertJsonPath('end_reason', 'Resignation');

    expect(Game::count())->toBe(1);
});

test('estatísticas públicas, pessoais e leaderboards devolvem cálculos corretos', function () {
    $p1 = User::factory()->create(['nickname' => 'campeao']);
    $p2 = User::factory()->create(['nickname' => 'desafiante']);

    Game::create([
        'type' => 'Blitz',
        'opening_type' => 'Free',
        'player1_user_id' => $p1->id,
        'player2_user_id' => $p2->id,
        'is_draw' => false,
        'winner_user_id' => $p1->id,
        'loser_user_id' => $p2->id,
        'status' => 'Ended',
        'end_reason' => 'CaptureAll',
        'player1_captures' => 12,
        'player2_captures' => 3,
        'total_moves' => 40,
    ]);

    Game::create([
        'type' => 'Rapid',
        'opening_type' => 'Free',
        'player1_user_id' => $p2->id,
        'player2_user_id' => $p1->id,
        'is_draw' => true,
        'status' => 'Ended',
        'end_reason' => 'DrawAgreement',
        'player1_captures' => 8,
        'player2_captures' => 8,
        'total_moves' => 50,
    ]);

    GameMatch::create([
        'type' => 'Blitz',
        'opening_type' => 'Free',
        'player1_user_id' => $p1->id,
        'player2_user_id' => $p2->id,
        'is_draw' => false,
        'winner_user_id' => $p1->id,
        'loser_user_id' => $p2->id,
        'status' => 'Ended',
        'player1_points' => 1.5,
        'player2_points' => 0.5,
    ]);

    $this->getJson('/api/statistics')
        ->assertOk()
        ->assertJsonPath('total_games', 2)
        ->assertJsonPath('total_draws', 1)
        ->assertJsonPath('total_matches', 1)
        ->assertJsonPath('total_captures', 31)
        ->assertJsonPath('games_by_type.Blitz', 1)
        ->assertJsonPath('games_by_type.Rapid', 1);

    $this->getJson('/api/leaderboards')
        ->assertOk()
        ->assertJsonPath('top_game_winners.0.user.id', $p1->id)
        ->assertJsonPath('top_game_winners.0.wins', 1)
        ->assertJsonPath('top_game_winners.0.win_rate', 50)
        ->assertJsonPath('top_match_winners.0.user.id', $p1->id);

    $this->actingAs($p1)
        ->getJson('/api/users/me/statistics')
        ->assertOk()
        ->assertJsonPath('games_played', 2)
        ->assertJsonPath('wins', 1)
        ->assertJsonPath('draws', 1)
        ->assertJsonPath('losses', 0)
        ->assertJsonPath('total_captures', 20)
        ->assertJsonPath('average_moves', 45);
});
