<?php

namespace App\Http\Controllers;

use App\Models\Game;
use Illuminate\Http\Request;

class WsGameController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'type' => 'required|in:Classic,Rapid,Blitz',
            'opening_type' => 'sometimes|in:Free,2-move,3-move',
            'player1_user_id' => 'required|exists:users,id',
            'player2_user_id' => 'required|exists:users,id|different:player1_user_id',
            'match_id' => 'nullable|exists:matches,id',
            'is_draw' => 'required|boolean',
            'winner_user_id' => 'nullable|exists:users,id',
            'loser_user_id' => 'nullable|exists:users,id',
            'status' => 'sometimes|in:Pending,Playing,Ended,Interrupted',
            'end_reason' => 'nullable|string|max:30',
            'began_at' => 'nullable|date',
            'ended_at' => 'nullable|date',
            'total_time' => 'nullable|numeric|min:0',
            'player1_captures' => 'sometimes|integer|min:0|max:12',
            'player2_captures' => 'sometimes|integer|min:0|max:12',
            'total_moves' => 'sometimes|integer|min:0',
            'moves_notation' => 'nullable|array',
            'custom' => 'nullable|array',
        ]);

        $game = Game::create([
            ...$data,
            'opening_type' => $data['opening_type'] ?? 'Free',
            'status' => $data['status'] ?? 'Ended',
        ]);

        return response()->json($game, 201);
    }
}
