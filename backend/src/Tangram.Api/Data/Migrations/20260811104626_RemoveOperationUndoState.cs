using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveOperationUndoState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // One-way for the data, not just the schema. Down re-adds the
            // columns but they come back empty, and an inverse cannot be
            // reconstructed after the fact: the payload records the state an
            // operation produced, never the one it replaced. So restoring undo
            // later means it starts working from that point forward, and
            // everything already in the log stays un-undoable.
            migrationBuilder.DropIndex(
                name: "ix_operations_board_id_actor_id_seq",
                table: "operations");

            migrationBuilder.DropColumn(
                name: "inverse_op_type",
                table: "operations");

            migrationBuilder.DropColumn(
                name: "inverse_payload",
                table: "operations");

            migrationBuilder.DropColumn(
                name: "undo_of_seq",
                table: "operations");

            migrationBuilder.DropColumn(
                name: "undone_at",
                table: "operations");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "inverse_op_type",
                table: "operations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "inverse_payload",
                table: "operations",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "undo_of_seq",
                table: "operations",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "undone_at",
                table: "operations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_operations_board_id_actor_id_seq",
                table: "operations",
                columns: new[] { "board_id", "actor_id", "seq" });
        }
    }
}
