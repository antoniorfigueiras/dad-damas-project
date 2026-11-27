<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'type',
    'opening_type',
    'player1_user_id',
    'player2_user_id',
    'is_draw',
    'winner_user_id',
    'loser_user_id',
    'match_id',
    'status',
    'end_reason',
    'began_at',
    'ended_at',
    'total_time',
    'player1_captures',
    'player2_captures',
    'total_moves',
    'moves_notation',
    'custom',
])]
class Game extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'is_draw' => 'boolean',
            'began_at' => 'datetime',
            'ended_at' => 'datetime',
            'total_time' => 'decimal:2',
            'player1_captures' => 'integer',
            'player2_captures' => 'integer',
            'total_moves' => 'integer',
            'moves_notation' => 'array',
            'custom' => 'array',
        ];
    }

    public function match(): BelongsTo
    {
        return $this->belongsTo(GameMatch::class, 'match_id');
    }

    public function player1(): BelongsTo
    {
        return $this->belongsTo(User::class, 'player1_user_id');
    }

    public function player2(): BelongsTo
    {
        return $this->belongsTo(User::class, 'player2_user_id');
    }

    public function winner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'winner_user_id');
    }

    public function loser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'loser_user_id');
    }
}
