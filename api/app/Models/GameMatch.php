<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'type',
    'opening_type',
    'player1_user_id',
    'player2_user_id',
    'is_draw',
    'winner_user_id',
    'loser_user_id',
    'status',
    'began_at',
    'ended_at',
    'total_time',
    'player1_points',
    'player2_points',
    'custom',
])]
class GameMatch extends Model
{
    protected $table = 'matches';

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'is_draw' => 'boolean',
            'began_at' => 'datetime',
            'ended_at' => 'datetime',
            'total_time' => 'decimal:2',
            'player1_points' => 'decimal:1',
            'player2_points' => 'decimal:1',
            'custom' => 'array',
        ];
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

    public function games(): HasMany
    {
        return $this->hasMany(Game::class, 'match_id');
    }
}
