<?php

namespace App\Http\Controllers;

use App\Models\Game;
use App\Models\GameMatch;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StatisticsController extends Controller
{
    public function summary()
    {
        $endedGames = Game::where('status', 'Ended');

        $byType = Game::where('status', 'Ended')
            ->select('type', DB::raw('COUNT(*) as total'))
            ->groupBy('type')
            ->pluck('total', 'type');

        return response()->json([
            'total_players' => User::where('type', 'P')->count(),
            'total_games' => (clone $endedGames)->count(),
            'total_draws' => (clone $endedGames)->where('is_draw', true)->count(),
            'total_matches' => GameMatch::where('status', 'Ended')->count(),
            'total_captures' => (int) (clone $endedGames)->sum(DB::raw('player1_captures + player2_captures')),
            'games_by_type' => [
                'Classic' => (int) ($byType['Classic'] ?? 0),
                'Rapid' => (int) ($byType['Rapid'] ?? 0),
                'Blitz' => (int) ($byType['Blitz'] ?? 0),
            ],
        ]);
    }

    public function leaderboards()
    {
        $topGameWinners = Game::where('status', 'Ended')
            ->whereNotNull('winner_user_id')
            ->select('winner_user_id', DB::raw('COUNT(*) as wins'))
            ->groupBy('winner_user_id')
            ->orderByDesc('wins')
            ->limit(10)
            ->with('winner:id,name,nickname,photo_avatar_filename')
            ->get()
            ->map(function ($row) {
                $uid = $row->winner_user_id;
                $played = Game::where('status', 'Ended')
                    ->where(fn ($q) => $q->where('player1_user_id', $uid)->orWhere('player2_user_id', $uid))
                    ->count();
                $draws = Game::where('status', 'Ended')
                    ->where('is_draw', true)
                    ->where(fn ($q) => $q->where('player1_user_id', $uid)->orWhere('player2_user_id', $uid))
                    ->count();

                return [
                    'user' => $row->winner,
                    'wins' => (int) $row->wins,
                    'draws' => $draws,
                    'losses' => max(0, $played - (int) $row->wins - $draws),
                    'games_played' => $played,
                    'win_rate' => $played > 0 ? round(((int) $row->wins / $played) * 100, 1) : 0.0,
                ];
            });

        $topMatchWinners = GameMatch::where('status', 'Ended')
            ->whereNotNull('winner_user_id')
            ->select('winner_user_id', DB::raw('COUNT(*) as wins'))
            ->groupBy('winner_user_id')
            ->orderByDesc('wins')
            ->limit(10)
            ->with('winner:id,name,nickname,photo_avatar_filename')
            ->get()
            ->map(fn ($row) => [
                'user' => $row->winner,
                'wins' => (int) $row->wins,
            ]);

        return response()->json([
            'top_game_winners' => $topGameWinners,
            'top_match_winners' => $topMatchWinners,
        ]);
    }

    public function myStatistics(Request $request)
    {
        $uid = $request->user()->id;

        $baseQuery = Game::where('status', 'Ended')
            ->where(fn ($q) => $q->where('player1_user_id', $uid)->orWhere('player2_user_id', $uid));

        $played = (clone $baseQuery)->count();
        $wins = (clone $baseQuery)->where('winner_user_id', $uid)->count();
        $losses = (clone $baseQuery)->where('loser_user_id', $uid)->count();
        $draws = (clone $baseQuery)->where('is_draw', true)->count();

        $capturesAsP1 = (int) Game::where('status', 'Ended')
            ->where('player1_user_id', $uid)
            ->sum('player1_captures');
        $capturesAsP2 = (int) Game::where('status', 'Ended')
            ->where('player2_user_id', $uid)
            ->sum('player2_captures');

        $avgMoves = (clone $baseQuery)->avg('total_moves');

        $byType = (clone $baseQuery)
            ->select('type', DB::raw('COUNT(*) as total'))
            ->groupBy('type')
            ->pluck('total', 'type');

        return response()->json([
            'games_played' => $played,
            'wins' => $wins,
            'losses' => $losses,
            'draws' => $draws,
            'win_rate' => $played > 0 ? round(($wins / $played) * 100, 1) : 0.0,
            'total_captures' => $capturesAsP1 + $capturesAsP2,
            'average_moves' => $avgMoves !== null ? round((float) $avgMoves, 1) : 0.0,
            'games_by_type' => [
                'Classic' => (int) ($byType['Classic'] ?? 0),
                'Rapid' => (int) ($byType['Rapid'] ?? 0),
                'Blitz' => (int) ($byType['Blitz'] ?? 0),
            ],
        ]);
    }
}
