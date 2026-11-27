<?php

namespace App\Http\Controllers;

use App\Models\Game;
use Illuminate\Http\Request;

class GameController extends Controller
{
    public function index(Request $request)
    {
        $query = Game::with(['player1:id,name,nickname', 'player2:id,name,nickname'])
            ->orderByDesc('id');

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }

        if ($request->boolean('mine')) {
            $uid = $request->user()->id;
            $query->where(fn($q) => $q->where('player1_user_id', $uid)->orWhere('player2_user_id', $uid));
        }

        return response()->json($query->paginate(15));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'type' => 'required|in:Classic,Rapid,Blitz',
            'opening_type' => 'sometimes|in:Free,2-move,3-move',
            'player1_user_id' => 'required|exists:users,id',
            'player2_user_id' => 'required|exists:users,id|different:player1_user_id',
            'match_id' => 'nullable|exists:matches,id',
            'status' => 'sometimes|in:Pending,Playing,Ended,Interrupted',
            'began_at' => 'nullable|date',
        ]);

        $game = Game::create([
            ...$data,
            'opening_type' => $data['opening_type'] ?? 'Free',
            'status' => $data['status'] ?? 'Playing',
            'began_at' => $data['began_at'] ?? now(),
        ]);

        return response()->json($game->load(['player1:id,name,nickname', 'player2:id,name,nickname']), 201);
    }

    public function show(Game $game)
    {
        return response()->json(
            $game->load(['player1:id,name,nickname', 'player2:id,name,nickname', 'winner:id,name,nickname', 'match'])
        );
    }

    public function update(Request $request, Game $game)
    {
        $data = $request->validate([
            'status' => 'sometimes|in:Pending,Playing,Ended,Interrupted',
            'is_draw' => 'sometimes|boolean',
            'winner_user_id' => 'nullable|exists:users,id',
            'loser_user_id' => 'nullable|exists:users,id',
            'end_reason' => 'nullable|string|max:30',
            'ended_at' => 'nullable|date',
            'total_time' => 'nullable|numeric|min:0',
            'player1_captures' => 'sometimes|integer|min:0|max:12',
            'player2_captures' => 'sometimes|integer|min:0|max:12',
            'total_moves' => 'sometimes|integer|min:0',
            'moves_notation' => 'nullable|array',
            'custom' => 'nullable|array',
        ]);

        $game->update($data);

        return response()->json($game->fresh(['player1:id,name,nickname', 'player2:id,name,nickname']));
    }
}
