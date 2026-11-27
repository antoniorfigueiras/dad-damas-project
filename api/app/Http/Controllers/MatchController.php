<?php

namespace App\Http\Controllers;

use App\Models\GameMatch;
use Illuminate\Http\Request;

class MatchController extends Controller
{
    public function index(Request $request)
    {
        $query = GameMatch::with(['player1:id,name,nickname', 'player2:id,name,nickname'])
            ->orderByDesc('id');

        if ($request->filled('status')) {
            $query->where('status', $request->status);
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
            'status' => 'sometimes|in:Pending,Playing,Ended,Interrupted',
            'began_at' => 'nullable|date',
        ]);

        $match = GameMatch::create([
            ...$data,
            'opening_type' => $data['opening_type'] ?? 'Free',
            'status' => $data['status'] ?? 'Playing',
            'began_at' => $data['began_at'] ?? now(),
        ]);

        return response()->json($match->load(['player1:id,name,nickname', 'player2:id,name,nickname']), 201);
    }

    public function show(GameMatch $match)
    {
        return response()->json(
            $match->load(['player1:id,name,nickname', 'player2:id,name,nickname', 'games'])
        );
    }

    public function update(Request $request, GameMatch $match)
    {
        $data = $request->validate([
            'status' => 'sometimes|in:Pending,Playing,Ended,Interrupted',
            'is_draw' => 'sometimes|boolean',
            'winner_user_id' => 'nullable|exists:users,id',
            'loser_user_id' => 'nullable|exists:users,id',
            'ended_at' => 'nullable|date',
            'total_time' => 'nullable|numeric|min:0',
            'player1_points' => 'nullable|numeric|min:0',
            'player2_points' => 'nullable|numeric|min:0',
            'custom' => 'nullable|array',
        ]);

        $match->update($data);

        return response()->json($match->fresh(['player1:id,name,nickname', 'player2:id,name,nickname', 'games']));
    }
}
