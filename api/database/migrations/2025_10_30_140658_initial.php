<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Administrator, Player
            $table->enum('type', ['A', 'P'])->default('P');

            // Nickname - must be unique
            $table->string('nickname', 20)->nullable()->unique();

            // User access is blocked
            $table->boolean('blocked')->default(false);

            // User Photo/Avatar
            $table->string('photo_avatar_filename')->nullable();

            // Users can be deleted with "soft deletes"
            $table->softDeletes();

            // custom data
            $table->json('custom')->nullable();
        });

        // NOTE: Only multiplayer matches are registered
        Schema::create('matches', function (Blueprint $table) {
            $table->id();

            // Rhythm / time control of the match (FPD Rules: Classic, Rapid, Blitz)
            $table->enum('type', ['Classic', 'Rapid', 'Blitz'])->default('Classic');

            // Opening rule (FPD Appendix A: Free, 2-move drawn, 3-move drawn)
            $table->enum('opening_type', ['Free', '2-move', '3-move'])->default('Free');

            // Player 1 (White pieces; usually creates the match)
            $table->unsignedBigInteger('player1_user_id');
            $table->foreign('player1_user_id')->references('id')->on('users');

            // Player 2 (Black pieces; usually joins the match)
            $table->unsignedBigInteger('player2_user_id');
            $table->foreign('player2_user_id')->references('id')->on('users');

            // True when the match has ended with a draw
            $table->boolean('is_draw')->default(false);

            // Winner (null when not ended, or when a draw)
            $table->unsignedBigInteger('winner_user_id')->nullable();
            $table->foreign('winner_user_id')->references('id')->on('users');

            // Loser (null when not ended, or when a draw)
            $table->unsignedBigInteger('loser_user_id')->nullable();
            $table->foreign('loser_user_id')->references('id')->on('users');

            // Match status
            // Pending - Match is waiting for players
            // Playing - Match is in progress
            // Ended - Match is over
            // Interrupted - Match was interrupted due to technical issues (not finished; no winner)
            // Note: depending on the project's implementation, some statuses may never be used
            $table->enum('status', ['Pending', 'Playing', 'Ended', 'Interrupted']);

            // Moment when the match began
            $table->dateTime('began_at')->nullable();
            // Moment when the match ended
            $table->dateTime('ended_at')->nullable();
            // Match total time (in seconds) = ended_at - began_at
            $table->decimal('total_time', 8, 2)->nullable();

            // Match score per FPD Art. 10 (1 point per win, 0.5 per draw, 0 per loss)
            $table->decimal('player1_points', 4, 1)->nullable();
            $table->decimal('player2_points', 4, 1)->nullable();

            // custom data
            $table->json('custom')->nullable();
        });

        // NOTE: Only multiplayer games are registered
        Schema::create('games', function (Blueprint $table) {
            $table->id();

            // Rhythm / time control of the game (FPD Rules: Classic, Rapid, Blitz)
            $table->enum('type', ['Classic', 'Rapid', 'Blitz'])->default('Classic');

            // Opening rule (FPD Appendix A: Free, 2-move drawn, 3-move drawn)
            $table->enum('opening_type', ['Free', '2-move', '3-move'])->default('Free');

            // Player 1 (White pieces; usually creates the game)
            $table->unsignedBigInteger('player1_user_id');
            $table->foreign('player1_user_id')->references('id')->on('users');

            // Player 2 (Black pieces; usually joins the game)
            $table->unsignedBigInteger('player2_user_id');
            $table->foreign('player2_user_id')->references('id')->on('users');

            // True when the game has ended with a draw
            $table->boolean('is_draw')->default(false);

            // Winner (null when not ended, or when a draw)
            $table->unsignedBigInteger('winner_user_id')->nullable();
            $table->foreign('winner_user_id')->references('id')->on('users');

            // Loser (null when not ended, or when a draw)
            $table->unsignedBigInteger('loser_user_id')->nullable();
            $table->foreign('loser_user_id')->references('id')->on('users');

            // Match (null for standalone games)
            $table->unsignedBigInteger('match_id')->nullable();
            $table->foreign('match_id')->references('id')->on('matches');

            // Game status: 'Pending', 'Playing', 'Ended', or 'Interrupted'.
            $table->enum('status', ['Pending', 'Playing', 'Ended', 'Interrupted']);

            // Reason the game ended (e.g. CaptureAll, Blocked, Resignation, Timeout, DrawAgreement, ThreefoldRepetition, TwentyMoveRule, Forcada12Moves)
            $table->string('end_reason', 30)->nullable();

            // Moment when the game began
            $table->dateTime('began_at')->nullable();
            // Moment when the game ended
            $table->dateTime('ended_at')->nullable();
            // Game total time (in seconds) = ended_at - began_at
            $table->decimal('total_time', 8, 2)->nullable();

            // Number of opponent pieces captured by each player (0 to 12)
            $table->unsignedTinyInteger('player1_captures')->default(0);
            $table->unsignedTinyInteger('player2_captures')->default(0);

            // Total moves played and FPD notation history (e.g. ["9-13", "21-17", "14x23"])
            $table->unsignedInteger('total_moves')->default(0);
            $table->json('moves_notation')->nullable();

            // custom data
            $table->json('custom')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::drop('games');
        Schema::drop('matches');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('deleted_at');
            $table->dropColumn('custom');
            $table->dropColumn('photo_avatar_filename');
            $table->dropColumn('blocked');
            $table->dropColumn('nickname');
            $table->dropColumn('type');
        });
    }
};
