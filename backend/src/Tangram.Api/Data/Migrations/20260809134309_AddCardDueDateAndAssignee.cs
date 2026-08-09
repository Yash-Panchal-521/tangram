using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tangram.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCardDueDateAndAssignee : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "assignee_id",
                table: "cards",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "due_at",
                table: "cards",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "assignee_id",
                table: "cards");

            migrationBuilder.DropColumn(
                name: "due_at",
                table: "cards");
        }
    }
}
