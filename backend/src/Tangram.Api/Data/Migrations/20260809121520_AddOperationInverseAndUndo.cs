using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOperationInverseAndUndo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
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
                name: "undone_at",
                table: "operations");
        }
    }
}
